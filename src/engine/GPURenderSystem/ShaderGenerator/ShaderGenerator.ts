import {
    GeometryBindingPoint, GlobalBindPoints,
    PipelineShaderLocations,
} from "../../../helpers/Types.ts";
import {pbrFragmentHelpers, pbrVertexHelpers, toneMappings} from "../../../helpers/pbrShaderFunctions.ts";
import {StandardMaterial} from "../../Material/StandardMaterial.ts";
import {Geometry} from "../../geometry/Geometry.ts";


export class ShaderGenerator {

    baseVertex(geometry: Geometry) {
        const overrides = geometry.shaderDescriptor.overrides;
        const HAS_UV = Boolean(overrides.HAS_UV);
        const HAS_JOINTS = Boolean(overrides.HAS_JOINTS);
        const HAS_WEIGHTS = Boolean(overrides.HAS_WEIGHTS);
        const HAS_NORMAL = Boolean(overrides.HAS_NORMAL_VEC3);
        const HAS_TANGENT = Boolean(overrides.HAS_TANGENT_VEC4);
        const HAS_COLOR = Boolean(overrides.HAS_COLOR_0_VEC3);

        geometry.shaderCode = `
struct vsIn {
    @location(${PipelineShaderLocations.POSITION}) pos: vec3f,
    ${HAS_UV ? `@location(${PipelineShaderLocations.UV}) uv: vec2f,` : ""}
    ${HAS_JOINTS ? `@location(${PipelineShaderLocations.JOINTS}) joints: vec4<u32>,` : ""}
    ${HAS_WEIGHTS ? `@location(${PipelineShaderLocations.WEIGHTS}) weights: vec4<f32>,` : ""}
    ${HAS_COLOR ? `@location(${PipelineShaderLocations.COLOR}) color: vec3<f32>,` : ""}
    ${HAS_NORMAL ? `@location(${PipelineShaderLocations.NORMAL}) normal: vec3<f32>,` : ""}
    ${HAS_TANGENT ? `@location(${PipelineShaderLocations.TANGENT}) tangent: vec4<f32>,` : ""}
};

struct vsOut {
    @builtin(position) clipPos: vec4f,
    @location(0) uv: vec2f,
    @location(1) worldPos:vec3f,
    @location(2) normal: vec3f,
    @location(3) T: vec4f,
    @location(4) color: vec3f,
};

@group(0) @binding(${GlobalBindPoints.PROJECTION_MATRIX}) var<uniform> projectionMatrix: mat4x4<f32>;
@group(0) @binding(${GlobalBindPoints.VIEW_MATRIX}) var<uniform> viewMatrix: mat4x4<f32>;
@group(2) @binding(${GeometryBindingPoint.MODEL_MATRIX}) var<uniform> modelMatrix:mat4x4<f32>;
${overrides.HAS_SKIN ? `@group(2) @binding(${GeometryBindingPoint.SKIN}) var<storage, read> boneMatrices: array<mat4x4<f32>>;` : ``}
${HAS_NORMAL ? `@group(2) @binding(${GeometryBindingPoint.NORMAL_MATRIX}) var<uniform> normalMatrix4: mat4x4<f32>;` : ""}

${pbrVertexHelpers(overrides)}

struct Info{
    worldPos:vec4f,
    T:vec4f,
    N:vec3f
}


@vertex
fn vs(in: vsIn) -> vsOut {
    var output: vsOut;
    
    output.uv = vec2f(0);
    output.color = vec3f(0);

    let info = getInfo(in);

    ${HAS_UV ? `output.uv = in.uv;` : ""}
    
    output.worldPos = info.worldPos.xyz;
    output.T = info.T;
    output.normal = info.N;
    output.clipPos = projectionMatrix * viewMatrix * info.worldPos;
    return output;
}`
    }

    getStandardCode(material: StandardMaterial) {
        const overrides = material.shaderDescriptor.overrides
        const bindings = material.shaderDescriptor.bindings.map(item => {
            return `@group(${item.group}) @binding(${item.binding}) ${item.address} ${item.name}:${item.wgslType};`
        }).join('\n')
        material.shaderCode = `
            struct DLight {
                color: vec3f, // 0 12
                intensity: f32, // 12 4
                position: vec3f, // 16 12
            };
            
            struct ALight {
                color: vec3f,
                intensity: f32,
            };
            
            
            struct LightCounts {
                directional: u32,
                ambient: u32,
                _pad: u32, 
                _pad1: u32, 
            };
            
            struct MaterialInfo {
                ior:f32,
                dielectricF0: vec3f,
                f0:vec3f,
                perceptualRoughness: f32,  
                alphaRoughness: f32,  
                metallic: f32,
                baseColor: vec3<f32>,
                baseColorAlpha: f32,
                ao:f32,
                fRoughness:vec3f,
                emissive:vec3f,
                normal:vec3f,
                
                // clearcoat
                clearcoatWeight:f32,
                clearcoatNormal:vec3f,
                clearcoatRoughness:f32,
                clearcoatF0:vec3f,
                clearcoatAlphaRoughness:f32,
                clearcoatF:vec3f,
                
                // sheen 
                sheenColor:vec3f,
                sheenRoughness:f32,
            
                // specular
                specularColor:vec3f,
                specular:f32,
                
                // anisotropic
                anisotropicT:vec3f,
                anisotropicB:vec3f,
                anisotropyStrength:f32,
                
                // iridescence
                iridescence:f32,
                iridescenceThickness:f32,
                iridescenceIOR:f32,
                
                // transmission
                transmissionWeight:f32,
                
                // volume
                attenuationDistance:f32,
                attenuationColor:vec3f,
                thickness:f32,
                
                // diffuse transmission
                diffuseTransmissionColor:vec3f,
                diffuseTransmission:f32,
                diffuseThickness:vec3f
            };

            struct MaterialFactors{
                baseColor:vec4f, // 0 16
                metallic:f32, // 16 4
                roughness:f32, // 20 4
                normalScale:f32, // 24 4
                occlusionStrength:f32, // 28 4
                emissive:vec3f, // 32 12 
                alphaCutoff:f32, // 44 4
                ior:f32, // 48 4,
                clearcoatIOR:f32, // 52 4,
                emissiveStrength:f32, // 56 4,
                sheenColor:vec3f, // 64 12
                sheenRoughness:f32, // 76 4 
                clearcoat:f32, // 80 4
                clearcoatNormalScale:f32, // 84 4
                clearcoatRoughness:f32, // 88 4
                specular:f32, // 92 4
                specularColor:vec3f, // 96 12 
                transmission:f32, // 108 4 
                dispersion:f32, // 112 4 
                thickness:f32, // 116 4 
                attenuationDistance:f32, // 120 4 
                attenuationColor:vec3f, // 128 12 
                iridescence:f32, // 140 4 ,
                minimumIridescenceThickness:f32, // 144 4,
                maximumIridescenceThickness:f32, // 148 4,
                iridescenceIor:f32, // 152 4,
                diffuseTransmission:f32, // 156 4,
                diffuseTransmissionColor:vec3f, // 160 12,
                anisotropy:vec3f, // 176 12,
                envIntensity:f32, // 188 4,
                envRotation:mat3x3f, // 192 48,
                pbrSpecular:vec3f, // 240 12,
                pbrGlossiness:f32, // 252 4,
                pbrSpecularGlossinessDiffuse:vec4f, // 256 16,
            }
            
        
            @group(0) @binding(7) var<storage, read> dLights: array<DLight>;
            @group(0) @binding(6) var<storage, read> aLights: array<ALight>;
            @group(0) @binding(8) var<uniform> lightCounts: LightCounts;
            @group(0) @binding(9) var ggxLUT:texture_2d<f32>;
            @group(0) @binding(13) var charlieLUT:texture_2d<f32>;
            @group(0) @binding(10) var ggxPrefilterMap:texture_cube<f32>;
            @group(0) @binding(14) var charliePrefilterMap:texture_cube<f32>;
            @group(0) @binding(11) var irradianceMap:texture_cube<f32>;
            @group(0) @binding(12) var iblSampler:sampler;
            @group(0) @binding(15) var sceneBackgroundTexture:texture_2d<f32>;
            
            @group(0) @binding(${GlobalBindPoints.PROJECTION_MATRIX}) var<uniform> projectionMatrix: mat4x4<f32>;
            @group(0) @binding(${GlobalBindPoints.VIEW_MATRIX}) var<uniform> viewMatrix: mat4x4<f32>;
            @group(2) @binding(${GeometryBindingPoint.MODEL_MATRIX}) var<uniform> modelMatrix:mat4x4<f32>;

            ${bindings}    
        
            @group(0) @binding(4) var<uniform> cameraPosition:vec3f;
            @group(0) @binding(3) var<uniform> resolution:vec2f;
            const PI = 3.141592653589793;
            override ENV_MAX_LOD_COUNT = 8;
            override SCENE_BACKGROUND_MAX_LOD = 6;
                        
            struct fsIn{
                @builtin(front_facing) frontFacing: bool,
                @builtin(position) clipPos: vec4f,
                @location(0) uv: vec2f,
                @location(1) worldPos:vec3f,
                @location(2) normal: vec3f,
                @location(3) T: vec4f,
                @location(4) color: vec3f,
            }
            
            ${pbrFragmentHelpers(overrides)}
            ${toneMappings.aces}
            
            @fragment fn fs(in: fsIn) -> @location(0) vec4f {
                var globalInfo:MaterialInfo;
                let uv=in.uv;
                let TBN=buildTBN(in.normal,in.T.xyz,in.T.w);
                var screenUV=in.clipPos.xy / resolution;
                screenUV=vec2f(screenUV.x,screenUV.y);
                globalInfo=setNormal(globalInfo,uv,TBN,in.normal);
                let faceSign=select(-1,1.,in.frontFacing);
                globalInfo.normal*=faceSign;
                globalInfo=setIridescence(globalInfo,uv,uv);
                globalInfo=setDiffuseTransmission(globalInfo,uv,uv);
                globalInfo=setVolume(globalInfo,uv);
                globalInfo=setAnisotropy(globalInfo,uv,TBN,in.normal);
                globalInfo=setSpecular(globalInfo,uv,uv);
                globalInfo=setTransmission(globalInfo,uv);
                globalInfo=setSheen(globalInfo,uv,uv);
                ${overrides.HAS_SPECULAR_GLOSSINESS?`
                    globalInfo=setSpecularGlossinessDiffuse(globalInfo,uv);
                `:`
                    globalInfo=setBaseColor(globalInfo,uv);
                `}
                globalInfo=setEmissive(globalInfo,uv);
                globalInfo.ior=materialFactors.ior;
                globalInfo=setMetallicRoughness(globalInfo,uv);
                globalInfo.dielectricF0=dielectricIorToF0(globalInfo.ior,1.) * globalInfo.specularColor;
                globalInfo=setAO(globalInfo,uv);
                globalInfo.f0=mix(globalInfo.dielectricF0,globalInfo.baseColor,globalInfo.metallic);
                globalInfo.f0 *=globalInfo.specular;
                globalInfo.diffuseThickness =vec3f(1);
                ${overrides.HAS_SPECULAR_GLOSSINESS?`
                    globalInfo =setSpecularGlossiness(globalInfo,uv);
                `:``}
                ${overrides.HAS_DIFFUSE_TRANSMISSION && overrides.HAS_VOLUME ? `
                globalInfo.diffuseThickness = globalInfo.thickness *
                (length(vec3(modelMatrix[0].xyz)) + length(vec3(modelMatrix[1].xyz)) + length(vec3(modelMatrix[2].xyz))) / 3.0;
                ` : ``}
                
                var LoSpecular = vec3f(0.0);
                var LoDiffuse = vec3f(0.0);
                var LoTransmission = vec3f(0.0);
                var LoDiffuseTransmission = vec3f(0.0);
                let v=normalize(cameraPosition - in.worldPos);
                let NoV=dot(globalInfo.normal,v);
                let r=reflect(-v,globalInfo.normal);
                
                globalInfo=setClearcoat(globalInfo,uv,TBN,materialFactors.clearcoatIOR);
                
                let CR=reflect(-v,globalInfo.clearcoatNormal);
                let NcV=saturate(dot(globalInfo.clearcoatNormal, v));
                var transmissionRay = getVolumeTransmissionRay(globalInfo.normal, v, globalInfo.thickness, globalInfo.ior, modelMatrix);

                for(var i=0;i < i32(lightCounts.directional); i++){
                    let light=dLights[i];
                    let lightIntensity=light.color * light.intensity;
                    var diffuse:vec3f;
                    var specular:vec3f;
                    var transmission: vec3f = vec3f(0.0);
                    var diffuseTransmission: vec3f = vec3f(0.0);
                    // brdf variables
                    let l=normalize(light.position - in.worldPos);
                    let NoL = saturate(dot(globalInfo.normal, l));
                    let h = normalize(l + v);
                    let NoH = saturate(dot(globalInfo.normal, h));
                    let HoL = saturate(dot(h, l));
                    let HoV = saturate(dot(h, v));
                    ${overrides.HAS_CLEARCOAT ? `
                    let NcH=saturate(dot(globalInfo.clearcoatNormal, h));
                    let NcL=saturate(dot(globalInfo.clearcoatNormal, l));
                    let CCNDF = D_GGX(NcH,globalInfo.clearcoatAlphaRoughness);        
                    let CCG   = G_Smith(NcL,NcV,globalInfo.clearcoatRoughness);    
                    let CCF   = fresnelSchlick(HoV,globalInfo.clearcoatF0);    
                    let CCDenominator = 4.0 * NcV * NcL + 1e-5;
                    let CCNumerator = CCNDF * CCG  * CCF;
                    var CCSpecular     = CCNumerator / CCDenominator; 
                    CCSpecular *=globalInfo.clearcoatWeight;
                    let transmittedFromCC= clamp(vec3f(1) - (globalInfo.clearcoatWeight * CCF),vec3f(0.),vec3f(1.));
                    ` : ``}
                    
                    ${overrides.HAS_IRIDESCENCE ? `
                    let iridescenceF0=calculateIridescenceF0(NoL,globalInfo.iridescenceIOR,1.,globalInfo.f0,globalInfo.iridescenceThickness);
                    ` : ``}
                    
                    var F0_total=globalInfo.f0;
                    ${overrides.HAS_IRIDESCENCE ? `
                    F0_total = mix(globalInfo.f0, iridescenceF0, globalInfo.iridescence);
                    ` : ``}
                    let F    = fresnelSchlick(HoV, F0_total); 
                    
                    var transmittedLight=vec3f(0);
                    

                    
                    ${overrides.HAS_SHEEN ? `
                    let Ds = D_Charlie(globalInfo.sheenRoughness, NoH);
                    let Vs = V_Charlie(globalInfo.sheenRoughness, NoV, NoL);
                    let sheenBRDF = Ds * Vs * materialFactors.sheenColor;
                    ` : ``}
                    
                    
                    ${overrides.HAS_ANISOTROPY ? `
                    let ToH = dot(globalInfo.anisotropicT, h);
                    let BoH = dot(globalInfo.anisotropicB, h);
                    
                    let ToV = dot(globalInfo.anisotropicT, v);
                    let BoV = dot(globalInfo.anisotropicB, v);
                    
                    let ToL = dot(globalInfo.anisotropicT, l);
                    let BoL = dot(globalInfo.anisotropicB, l);
                    
                    let at = mix(globalInfo.alphaRoughness, 1.0, globalInfo.anisotropyStrength * globalInfo.anisotropyStrength);
                    let ab = globalInfo.alphaRoughness;
                    let eps = 0.001;
                    let at_clamped = max(at, eps);
                    let ab_clamped = max(ab, eps);
                    
                    let NDF = D_GGX_Aniso(ToH, BoH, NoH, at_clamped, ab_clamped);
                    let G   = G_Smith_Aniso(NoL, NoV, ToV, BoV, ToL, BoL, at_clamped, ab_clamped);
                    ` : `
                    let NDF = D_GGX(NoH,globalInfo.alphaRoughness);        
                    let G   = G_Smith(NoL,NoV,globalInfo.perceptualRoughness); 
                    `}     
                   

                          
                    let kS = F;
                    var kD = vec3(1.0) - kS;
                    kD *= 1.0 - globalInfo.metallic;
                    diffuse = kD * globalInfo.baseColor / PI;
                    let numerator    = NDF * G * F;
                    let denominator = 4.0 * NoV * NoL + 1e-5;
                    specular     = numerator / denominator;  
                    
                    ${overrides.HAS_DIFFUSE_TRANSMISSION ? `
                    if(dot(globalInfo.normal, l) < 0.0){
                        let l_mirror = normalize(l + 2.0 * globalInfo.normal * dot(-l, globalInfo.normal));
                        let diffuseH=normalize(l_mirror + v);
                        let diffuseHoV = saturate(dot(v, diffuseH));
                        let diffuseF=fresnelSchlick(diffuseHoV, F0_total);
                        
                        let diffuseKS = diffuseF;
                        var diffuseKD = vec3(1.0) - diffuseKS;
                        diffuseKD *= 1.0 - globalInfo.metallic;
                        
                        let diffuseNoL = saturate(dot(-globalInfo.normal, l));
                        let diffuse_btdf = diffuseNoL * (diffuseKD * globalInfo.diffuseTransmissionColor / PI);
                        
                        ${overrides.HAS_VOLUME ? `
                        diffuse_btdf = applyVolumeAttenuation(diffuse_btdf, globalInfo.diffuseThickness, globalInfo.attenuationColor, globalInfo.attenuationDistance);
                        
                        ` : ``}
                        diffuseTransmission += diffuse_btdf;
                    
                    }
                    ` : ``}          
                    
                    ${overrides.HAS_TRANSMISSION ? `
                    
                    var transmissionLight=l;
                    transmissionLight -= transmissionRay;
                    transmissionLight = normalize(transmissionLight);

                    transmittedLight = getPunctualRadianceTransmission(F0_total,globalInfo.normal, v,transmissionLight, globalInfo.alphaRoughness, globalInfo.baseColor, globalInfo.ior);
                    ${overrides.HAS_VOLUME ? `
                    transmittedLight = applyVolumeAttenuation(transmittedLight, length(transmissionRay), globalInfo.attenuationColor, globalInfo.attenuationDistance);
                    ` : ``}
                    transmission+=transmittedLight;
                    ` : ``}

                    ${overrides.HAS_CLEARCOAT ? `
                    specular *=transmittedFromCC; 
                    diffuse *=transmittedFromCC; 
                    specular += (CCSpecular * NcL) * lightIntensity;
                    ` : ``}
                    ${overrides.HAS_SHEEN ? `
                    diffuse += (sheenBRDF * NoL) * lightIntensity;
                    ` : ``}
                    
                    LoSpecular += (specular * NoL) * lightIntensity; 
                    LoDiffuse += (diffuse * NoL) * lightIntensity; 
                    LoTransmission += (transmission) * lightIntensity; 
                    LoDiffuseTransmission += (diffuseTransmission) * lightIntensity; 
                }
                var F0_total =globalInfo.f0;
                
                ${overrides.HAS_IRIDESCENCE ? `
                let iridescenceF0=calculateIridescenceF0(NoV,globalInfo.iridescenceIOR,1.,globalInfo.f0,globalInfo.iridescenceThickness);
                F0_total = mix(globalInfo.f0, iridescenceF0, globalInfo.iridescence);
                ` : ``}
                globalInfo.fRoughness=FresnelSchlickRoughness(NoV, F0_total, globalInfo.perceptualRoughness);

                ${overrides.HAS_TRANSMISSION ? `
                LoTransmission +=
                getIBLVolumeRefraction(
                globalInfo.normal,
                v,
                globalInfo.perceptualRoughness,
                globalInfo.baseColor,
                in.worldPos,
                modelMatrix,
                viewMatrix,
                projectionMatrix,
                globalInfo.ior,
                globalInfo.thickness,
                globalInfo.attenuationColor,
                globalInfo.attenuationDistance,
                materialFactors.dispersion,
                );
                ` : ``}
                
                let kS_view = globalInfo.fRoughness;
                var kD_view = 1.0 - kS_view;
                kD_view *= 1.0 - globalInfo.metallic;
                
                for(var i=0;i < i32(lightCounts.ambient); i++){
                    let light=aLights[i];
                    let radiance=light.color * light.intensity;

                    let diffuse = (globalInfo.baseColor / PI) * radiance;
                    LoDiffuse += diffuse * kD_view * globalInfo.ao; 
                }
                var x=vec3f(LoSpecular);
                ${overrides.HAS_CLEARCOAT ? `
                globalInfo.clearcoatF=FresnelSchlickRoughness(NcV, globalInfo.clearcoatF0, globalInfo.clearcoatRoughness);
                let iblTransmittedFromCC = max(vec3f(0.0), vec3f(1.0) - globalInfo.clearcoatWeight * globalInfo.clearcoatF);
                let ccSpecularIBL = getClearcoatIBL(
                    CR,
                    NcV,
                    globalInfo.clearcoatF,
                    globalInfo.clearcoatRoughness
                ) * globalInfo.clearcoatWeight;
                
                LoSpecular += ccSpecularIBL;
                x=ccSpecularIBL;
                ` : ``}

                                       
                ${overrides.HAS_SHEEN ? `
                let albedoSheenScaling = 1.0 - max3(globalInfo.sheenColor) * charlieLUTSampler(globalInfo.sheenRoughness,NoV);
                let sheenIbl =getSheenIBL(
                r,
                NoV,
                globalInfo.sheenRoughness
                ) * globalInfo.sheenColor;
                ` : ``}

                
                ${overrides.HAS_ANISOTROPY ? `
                var bentNormal = cross(globalInfo.anisotropicB, v);
                bentNormal = normalize(cross(bentNormal, globalInfo.anisotropicB));
                
                let a = pow(pow(1.0 - globalInfo.anisotropyStrength * (1.0 - globalInfo.perceptualRoughness),2),2);
                bentNormal = normalize(mix(bentNormal, globalInfo.normal, a));
                var Ar = reflect(-v, bentNormal);
                Ar = normalize(mix(Ar, bentNormal, globalInfo.perceptualRoughness * globalInfo.perceptualRoughness));

                var baseIBL=getIBL(
                globalInfo.baseColor,
                globalInfo.metallic,
                globalInfo.normal,
                Ar,
                NoV,
                globalInfo.fRoughness,
                globalInfo.perceptualRoughness,
                globalInfo.ao,
                );
                let baseIBLDiffuse=baseIBL.diffuse;
                let baseIBLSpecular=baseIBL.specular;
                ` : `
                var baseIBL=getIBL(
                globalInfo.baseColor,
                globalInfo.metallic,
                globalInfo.normal,
                r,
                NoV,
                globalInfo.fRoughness,
                globalInfo.perceptualRoughness,
                globalInfo.ao,
                );
                var baseIBLDiffuse=baseIBL.diffuse;
                var baseIBLSpecular=baseIBL.specular;
                `}
                
                ${overrides.HAS_SHEEN ? `
                baseIBLDiffuse = sheenIbl + baseIBLDiffuse * albedoSheenScaling;
                ` : ``}
                
                ${overrides.HAS_CLEARCOAT ? `
                baseIBLSpecular *=iblTransmittedFromCC;
                baseIBLDiffuse *=iblTransmittedFromCC;
                ` : ``}      
                
                var diffuseTransmissionIBL:vec3f;          
                ${overrides.HAS_DIFFUSE_TRANSMISSION ? `
                diffuseTransmissionIBL=getDiffuseTransmissionIBL(
                globalInfo.normal,
                globalInfo.diffuseTransmissionColor,
                globalInfo.diffuseTransmission,
                globalInfo.diffuseThickness,
                globalInfo.attenuationColor,
                globalInfo.attenuationDistance,
                );
                LoDiffuseTransmission +=diffuseTransmissionIBL;
                ` : ``}
                
                
                
                LoSpecular +=baseIBLSpecular;
                LoDiffuse +=baseIBLDiffuse;
                var emissive=globalInfo.emissive;
                ${overrides.HAS_CLEARCOAT ? `
                emissive *=iblTransmittedFromCC;
                ` : ``}
                
                LoDiffuse *=(1. - globalInfo.transmissionWeight);
                LoDiffuse *= (1. - globalInfo.diffuseTransmission);
                LoTransmission *= globalInfo.transmissionWeight * (1 - globalInfo.fRoughness) * (1. - globalInfo.metallic);
                LoDiffuseTransmission *=globalInfo.diffuseTransmission * (1 - globalInfo.fRoughness)  * (1. - globalInfo.metallic);;
                
                let Lo = LoDiffuse + LoSpecular + LoDiffuseTransmission + LoTransmission;
                var color=vec4f(Lo,globalInfo.baseColorAlpha);
                color = vec4f(color.rgb + emissive,globalInfo.baseColorAlpha);
                color = vec4f(toneMapping(color.rgb),globalInfo.baseColorAlpha);
                color = vec4f(applyGamma(color.rgb,2.2),globalInfo.baseColorAlpha);
                // color = vec4f(vec3f(Lo),globalInfo.baseColorAlpha);
                ${overrides.ALPHA_MODE === 0 ? `
                color.a=1.;
                ` : overrides.ALPHA_MODE === 2 ? `
                if(color.a < materialFactors.alphaCutoff) {
                    discard;
                }
                color.a=1.;
                ` : ``}
                
                ${overrides.IS_UNLIT ? `
                return vec4f(globalInfo.baseColor+ globalInfo.emissive,globalInfo.baseColorAlpha);
                ` : `
                return color;
                `}
               
            }
        `
    }

}