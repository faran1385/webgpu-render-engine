import {
    GeometryBindingPoint,
    PipelineShaderLocations,
    RenderFlag,
    StandardMaterialBindPoint,
    StandardMaterialFactorsStartPoint
} from "../MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";
import {Primitive} from "../../primitive/Primitive.ts";
import {
    anisotropy,
    distributionGGX,
    fresnelSchlick,
    fresnelSchlickRoughness,
    geometrySmith
} from "../../../helpers/pbrShaderFunctions.ts";
import {
    EXPOSURE,
    GAMMA_CORRECTION,
    TONE_MAPPING,
    TONE_MAPPING_CALL
} from "../../../helpers/postProcessUtils/postProcessUtilsShaderCodes.ts";


export class ShaderGenerator {

    baseVertex(hasBoneData: boolean, hasUV: boolean, hasNormal: boolean, useNormalMap: boolean): string {

        return `
struct vsIn {
    @location(${PipelineShaderLocations.POSITION}) pos: vec3f,
    ${hasUV ? `@location(${PipelineShaderLocations.UV}) uv: vec2f,` : ""}
    ${hasBoneData ? `
    @location(${PipelineShaderLocations.JOINTS}) joints: vec4<u32>,
    @location(${PipelineShaderLocations.WEIGHTS}) weights: vec4f,
    ` : ""}
    ${hasNormal ? `
    @location(${PipelineShaderLocations.NORMAL}) normal: vec3<f32>,
    ` : ""}
    ${useNormalMap ? `
        @location(${PipelineShaderLocations.TANGENT}) tangent: vec4<f32>,
    ` : ""}
};

struct vsOut {
    @builtin(position) clipPos: vec4f,
    ${hasUV ? `@location(0) uv: vec2f,` : ""}
    ${hasNormal ? `@location(2) normal: vec3f,` : ""}
    ${useNormalMap ?
            `@location(3) T: vec3f,
             @location(4) N: vec3f,
             @location(5) B: vec3f,`
            : ""}
    @location(1) worldPos:vec3f,
};

@group(0) @binding(0) var<uniform> projectionMatrix: mat4x4<f32>;
@group(0) @binding(1) var<uniform> viewMatrix: mat4x4<f32>;
${!hasBoneData ? `@group(2) @binding(${GeometryBindingPoint.MODEL_MATRIX}) var<uniform> modelMatrix:mat4x4<f32>;` : ""}
${hasBoneData ? `@group(2) @binding(${GeometryBindingPoint.SKIN}) var<storage, read> jointMatrices: array<mat4x4<f32>>;` : ""}
${hasNormal ? `@group(2) @binding(${GeometryBindingPoint.NORMAL_MATRIX}) var<uniform> normalMatrix4: mat4x4<f32>;` : ""}

${hasBoneData ? `
fn skinMat(mats: array<mat4x4<f32>,4>, w: vec4<f32>, p: vec4<f32>) -> vec4<f32> {
    let ws = w / (w.x + w.y + w.z + w.w);
    return mats[0] * p * ws.x +
           mats[1] * p * ws.y +
           mats[2] * p * ws.z +
           mats[3] * p * ws.w;
}

fn skinNormal(
    mats: array<mat4x4<f32>, 4>,
    w: vec4<f32>,
    n: vec3<f32>
) -> vec3<f32> {
    let skinned4 = skinMat(mats, w, vec4<f32>(n, 0.0));
    return normalize(skinned4.xyz);
}
` : ''}
@vertex
fn vs(in: vsIn) -> vsOut {
    var output: vsOut;
    ${hasNormal ? `let normalMatrix =mat3x3<f32>(
    normalMatrix4[0].xyz,
    normalMatrix4[1].xyz,
    normalMatrix4[2].xyz
);` : ""}

    ${hasBoneData ? `
    let mats = array<mat4x4<f32>,4>(
            jointMatrices[in.joints.x],
            jointMatrices[in.joints.y],
            jointMatrices[in.joints.z],
            jointMatrices[in.joints.w]
        );
    ` : ""}

    let pos = vec4f(in.pos, 1.0);

    ${hasBoneData ? `let skPos = skinMat(mats, in.weights, vec4<f32>(in.pos, 1.0));` : ""}
    ${!hasBoneData ? `var worldPos = modelMatrix * pos;` : ""}
    
    ${hasBoneData ? `
        output.clipPos = projectionMatrix * viewMatrix * skPos;` : `
        output.clipPos = projectionMatrix * viewMatrix * worldPos;
    `}
    ${hasUV ? `output.uv = in.uv;` : ""}
    
    ${useNormalMap ? hasBoneData ? `
        let N = skinNormal(mats, in.weights, in.normal);
        var T = skinNormal(mats, in.weights, in.tangent.xyz);
        
        T = normalize(T - N * dot(N, T));
        
        var B = cross(N, T) * in.tangent.w;
        B = normalize(B);
        
        output.normal = N;
        output.T      = T;
        output.B      = B;
    ` : `
        let T = normalize(normalMatrix * in.tangent.xyz);
        let N = normalize(normalMatrix * in.normal);
        let B = cross(N, T) * in.tangent.w;
        
        output.normal = N;
        output.T = T;
        output.B = B;
    ` : hasNormal ? `output.normal = normalize(normalMatrix * in.normal);` : ''}
    ${hasBoneData ? `
        output.worldPos = skPos.xyz;
    ` : `
        output.worldPos = worldPos.xyz;
    `}
    return output;
}`
    }

    getStandardCode(primitive: Primitive) {
        const needUv = Boolean(primitive.geometry.dataList.get('TEXCOORD_0') && Array.from(primitive.material.textureDataMap).some(([_, value]) => {
            return value.texture
        }));
        const dataMap = primitive.material.textureDataMap
        const hasBoneData = Boolean(primitive.geometry.dataList.get('JOINTS_0') && primitive.geometry.dataList.get("WEIGHTS_0"))
        const hasNormal = Boolean(primitive.geometry.dataList.get('NORMAL'))
        const canUseNormalMap = Boolean((primitive.material.textureDataMap.get(RenderFlag.NORMAL)?.texture || primitive.material.textureDataMap.get(RenderFlag.CLEARCOAT_NORMAL)) && primitive.geometry.dataList.has("NORMAL") && primitive.geometry.dataList.has("TANGENT"))
        const generatedVertexCode = this.baseVertex(hasBoneData, needUv, hasNormal, canUseNormalMap)
        const workFlow = primitive.material.workFlow;
        const hasClearcoat = Boolean(primitive.material.textureDataMap.get(RenderFlag.CLEARCOAT));
        const hasClearcoatNormal = Boolean(primitive.material.textureDataMap.get(RenderFlag.CLEARCOAT_NORMAL)?.texture);
        const hasAnisotropy = Boolean(primitive.material.textureDataMap.get(RenderFlag.ANISOTROPY));

        return generatedVertexCode + '\n' + `
            struct DLight {
                color: vec3f,
                intensity: f32,
                _pad: f32, 
                _pad1: vec2f, 
                position: vec3f,
            };
            
            struct ALight {
                color: vec3f,
                intensity: f32,
                _pad: f32, 
                _pad1: vec2f, 
            };
            
            
            struct LightCounts {
                directional: u32,
                ambient: u32,
                _pad: u32, 
                _pad1: u32, 
            };
        
            @group(0) @binding(7) var<storage, read> dLights: array<DLight>;
            @group(0) @binding(6) var<storage, read> aLights: array<ALight>;
            @group(0) @binding(8) var<uniform> lightCounts: LightCounts;
            @group(0) @binding(9) var brdfLUT:texture_2d<f32>;
            @group(0) @binding(10) var prefilterMap:texture_cube<f32>;
            @group(0) @binding(11) var irradianceMap:texture_cube<f32>;
            @group(0) @binding(12) var iblSampler:sampler;

            @group(1) @binding(${StandardMaterialBindPoint.SAMPLER}) var textureSampler:sampler;
            @group(1) @binding(${StandardMaterialBindPoint.FACTORS}) var<storage,read> factors:array<f32>;
            ${dataMap.get(RenderFlag.BASE_COLOR)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.BASE_COLOR]) ? `@group(1) @binding(${StandardMaterialBindPoint.BASE_COLOR}) var baseColorTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.DIFFUSE)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.DIFFUSE]) ? `@group(1) @binding(${StandardMaterialBindPoint.DIFFUSE}) var diffuseTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.EMISSIVE)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.EMISSIVE]) ? `@group(1) @binding(${StandardMaterialBindPoint.EMISSIVE}) var emissiveTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.METALLIC)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.METALLIC]) ? `@group(1) @binding(${StandardMaterialBindPoint.METALLIC}) var metallicRoughnessTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.NORMAL)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.NORMAL]) ? `@group(1) @binding(${StandardMaterialBindPoint.NORMAL}) var normalTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.OCCLUSION)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.OCCLUSION]) ? `@group(1) @binding(${StandardMaterialBindPoint.OCCLUSION}) var occlusionTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.SPECULAR)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.SPECULAR]) ? `@group(1) @binding(${StandardMaterialBindPoint.SPECULAR})  var specularTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.SPECULAR_COLOR)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.SPECULAR_COLOR]) ? `@group(1) @binding(${StandardMaterialBindPoint.SPECULAR_COLOR})  var specularColorTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.TRANSMISSION)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.TRANSMISSION]) ? `@group(1) @binding(${StandardMaterialBindPoint.TRANSMISSION})  var transmissionTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.CLEARCOAT)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.CLEARCOAT]) ? `@group(1) @binding(${StandardMaterialBindPoint.CLEARCOAT}) var clearcoatTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.CLEARCOAT_ROUGHNESS)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.CLEARCOAT_ROUGHNESS]) ? `@group(1) @binding(${StandardMaterialBindPoint.CLEARCOAT_ROUGHNESS}) var clearcoatRoughnessTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.CLEARCOAT_NORMAL)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.CLEARCOAT_NORMAL]) ? `@group(1) @binding(${StandardMaterialBindPoint.CLEARCOAT_NORMAL}) var clearcoatNormalTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.PBR_SPECULAR)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.PBR_SPECULAR]) ? `@group(1) @binding(${StandardMaterialBindPoint.PBR_SPECULAR}) var specularGlossinessTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.ANISOTROPY)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.ANISOTROPY]) ? `@group(1) @binding(${StandardMaterialBindPoint.ANISOTROPY}) var anisotropyTexture:texture_2d<f32>;` : ""}
            
            @group(0) @binding(4) var<uniform> cameraPosition:vec3f;
            const MAX_REFLECTION_LOD = ${primitive.sceneObject.scene.ENV_MAX_LOD_COUNT ?? 0};
            const PI = 3.14159265359;
            ${distributionGGX}
            ${geometrySmith}
            ${fresnelSchlick}
            ${fresnelSchlickRoughness}
            ${GAMMA_CORRECTION}
            ${TONE_MAPPING}
            ${EXPOSURE}
            ${hasAnisotropy ? anisotropy : ''}
            
            override TONE_MAPPING_NUMBER = 0;
            override EXPOSURE = 0.;
            override ALPHA_MODE = 0;
            override ALPHA_CUTOFF = 0.;
            
            
            fn getIBL(NoV:f32,f0:vec3f,roughness:f32,metallic:f32,n:vec3f,v:vec3f,r:vec3f,albedo:vec3f,ao:f32)->vec3f{
                let irradiance = textureSample(irradianceMap, iblSampler, n).xyz;  
                let envBRDF  = textureSample(brdfLUT,iblSampler, vec2f(max(dot(n, v), 0.0), roughness)).rg;
                let prefilteredColor = textureSampleLevel(prefilterMap,iblSampler, r,  roughness * MAX_REFLECTION_LOD).rgb; 
                let F = fresnelSchlickRoughness(NoV, f0,roughness);
                let kS = F;
                var kD = 1.0 - kS;
                kD *= 1.0 - metallic;
            
                let diffuse=irradiance * albedo.xyz * kD;
                let specular = (prefilteredColor) * (F * envBRDF.x + envBRDF.y);
                
                return (diffuse + specular) * ao;
            }            
            
            
            ${hasAnisotropy ? `
                fn getAnisotropicIBL(
                    NoV:       f32,
                    f0:        vec3f,
                    roughness: f32,
                    metallic:  f32,
                    n:         vec3f,
                    v:         vec3f,
                    R:         vec3f,
                    albedo:    vec3f,
                    ao:        f32,
                    anisotropy:   f32,
                    anisotropicT: vec3f,
                    anisotropicB: vec3f
                ) -> vec3f {
                    let k = sqrt(1.0 - abs(anisotropy));
                    let Rt = vec3f(
                        R.x * mix(1.0, k, 1.0 - anisotropy),
                        R.y * mix(1.0, k, 1.0 + anisotropy),
                        R.z
                    );
                    let Rw = normalize(Rt.x * anisotropicT + Rt.y * anisotropicB + Rt.z * n);
                
                    let irradiance     = textureSample(irradianceMap, iblSampler, n).xyz;
                    let envBRDF        = textureSample(brdfLUT,    iblSampler, vec2f(max(NoV, 0.0), roughness)).rg;
                    let prefiltered    = textureSampleLevel(prefilterMap, iblSampler, Rw, roughness * MAX_REFLECTION_LOD).rgb;
                
                    let F              = fresnelSchlickRoughness(NoV, f0, roughness);
                    let kS             = F;
                    var kD             = 1.0 - kS;
                        kD            *= 1.0 - metallic;
                
                    let diffuse        = irradiance * albedo * kD;
                    let specular       = prefiltered * (F * envBRDF.x + envBRDF.y);
                
                    return (diffuse + specular) * ao;
                }

            ` : ``}
            
            
            ${hasClearcoat ? `
            struct clearcoatIblOutput{
                specular:vec3f,
                emissionMultiplier:f32
            }
            fn getClearcoatIBL(NoV:f32,f0:vec3f,roughness:f32,n:vec3f,v:vec3f,r:vec3f,clearcoatFactor:f32)->clearcoatIblOutput{
                let envBRDF  = textureSample(brdfLUT,iblSampler, vec2f(max(dot(n, v), 0.0), roughness)).rg;
                let prefilteredColor = textureSampleLevel(prefilterMap,iblSampler, r,  roughness * MAX_REFLECTION_LOD).rgb; 
                let F = fresnelSchlickRoughness(NoV, f0,roughness);
                var out:clearcoatIblOutput;
                            
                let specular = (prefilteredColor) * (F * envBRDF.x + envBRDF.y);
                
                out.specular=specular * clearcoatFactor * .25;
                out.emissionMultiplier=1.0 - factors[${StandardMaterialFactorsStartPoint.CLEARCOAT}] * F.r;
                
                return out;
            }`:''}
            
            @fragment fn fs(in: vsOut) -> @location(0) vec4f {
                var ao  = ${dataMap.get(RenderFlag.OCCLUSION)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.OCCLUSION]) ? `textureSample(occlusionTexture,textureSampler,in.uv).r * factors[${StandardMaterialFactorsStartPoint.OCCLUSION}];` : `factors[${StandardMaterialFactorsStartPoint.OCCLUSION}];`}
                var specularF0  =${dataMap.get(RenderFlag.SPECULAR)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.SPECULAR]) ? `textureSample(specularTexture,textureSampler,in.uv).a * factors[${StandardMaterialFactorsStartPoint.SPECULAR}];` : `factors[${StandardMaterialFactorsStartPoint.SPECULAR}];`}
                var specularColor   =${dataMap.get(RenderFlag.SPECULAR_COLOR)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.SPECULAR_COLOR]) ? `textureSample(specularColorTexture,textureSampler,in.uv).xyz * vec3f(factors[${StandardMaterialFactorsStartPoint.SPECULAR_COLOR}],factors[${StandardMaterialFactorsStartPoint.SPECULAR_COLOR + 1}],factors[${StandardMaterialFactorsStartPoint.SPECULAR_COLOR + 2}]);` : `vec3f(factors[${StandardMaterialFactorsStartPoint.SPECULAR_COLOR}],factors[${StandardMaterialFactorsStartPoint.SPECULAR_COLOR + 1}],factors[${StandardMaterialFactorsStartPoint.SPECULAR_COLOR + 2}]);`};
                var emissive  = ${dataMap.get(RenderFlag.EMISSIVE)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.EMISSIVE]) ? `textureSample(emissiveTexture,textureSampler,in.uv).rgb * vec3f(factors[${StandardMaterialFactorsStartPoint.EMISSIVE}],factors[${StandardMaterialFactorsStartPoint.EMISSIVE + 1}],factors[${StandardMaterialFactorsStartPoint.EMISSIVE + 2}]);` : `vec3f(factors[${StandardMaterialFactorsStartPoint.EMISSIVE}],factors[${StandardMaterialFactorsStartPoint.EMISSIVE + 1}],factors[${StandardMaterialFactorsStartPoint.EMISSIVE + 2}]);`}
                ${hasAnisotropy ? `
                var anisotropy = factors[${StandardMaterialFactorsStartPoint.ANISOTROPY}];
                var direction = vec2f(
                factors[${StandardMaterialFactorsStartPoint.ANISOTROPY + 1}],
                factors[${StandardMaterialFactorsStartPoint.ANISOTROPY + 2}]
                );
                ${dataMap.get(RenderFlag.ANISOTROPY)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.ANISOTROPY]) ? `
                let anisotropyTex = textureSample(anisotropyTexture,textureSampler,in.uv).rgb;
                direction = anisotropyTex.rg * 2.0 - vec2(1.0);
                direction = mat2x2f(
                factors[${StandardMaterialFactorsStartPoint.ANISOTROPY + 1}],
                factors[${StandardMaterialFactorsStartPoint.ANISOTROPY + 2}],
                -factors[${StandardMaterialFactorsStartPoint.ANISOTROPY + 2}],
                 factors[${StandardMaterialFactorsStartPoint.ANISOTROPY + 1}]
                 ) * normalize(direction);
                 anisotropy *= anisotropyTex.b;
                ` : ``};    
                ` : ``}
                ${hasClearcoat ? `
                let clearcoat=${dataMap.get(RenderFlag.CLEARCOAT)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.CLEARCOAT]) ? `textureSample(clearcoatTexture,textureSampler,in.uv).r * factors[${StandardMaterialFactorsStartPoint.CLEARCOAT}];` : `factors[${StandardMaterialFactorsStartPoint.CLEARCOAT}]`};
                var clearcoatRoughness=${dataMap.get(RenderFlag.CLEARCOAT_ROUGHNESS)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.CLEARCOAT_ROUGHNESS]) ? `textureSample(clearcoatRoughnessTexture,textureSampler,in.uv).g * factors[${StandardMaterialFactorsStartPoint.CLEARCOAT_ROUGHNESS}];` : `factors[${StandardMaterialFactorsStartPoint.CLEARCOAT_ROUGHNESS}]`};
                clearcoatRoughness = clamp(clearcoatRoughness, 0.04, 1.0);
                let clearcoatNormal=${dataMap.get(RenderFlag.CLEARCOAT_NORMAL)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.CLEARCOAT_NORMAL]) ? `textureSample(clearcoatNormalTexture,textureSampler,in.uv).g * factors[${StandardMaterialFactorsStartPoint.CLEARCOAT_NORMAL}];` : `factors[${StandardMaterialFactorsStartPoint.CLEARCOAT_NORMAL}]`};
                ` : ''}
                var albedo = ${workFlow === "metallic_roughness" ? `
                    ${dataMap.get(RenderFlag.BASE_COLOR)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.BASE_COLOR]) ? `textureSample(baseColorTexture, textureSampler, in.uv) * vec4f(factors[${StandardMaterialFactorsStartPoint.BASE_COLOR}], factors[${StandardMaterialFactorsStartPoint.BASE_COLOR + 1}], factors[${StandardMaterialFactorsStartPoint.BASE_COLOR + 2}], factors[${StandardMaterialFactorsStartPoint.BASE_COLOR + 3}])` : `vec4f(factors[${StandardMaterialFactorsStartPoint.BASE_COLOR}], factors[${StandardMaterialFactorsStartPoint.BASE_COLOR + 1}], factors[${StandardMaterialFactorsStartPoint.BASE_COLOR + 2}], factors[${StandardMaterialFactorsStartPoint.BASE_COLOR + 3}])`}
                ` : `
                    ${dataMap.get(RenderFlag.DIFFUSE)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.DIFFUSE]) ? `textureSample(diffuseTexture, textureSampler, in.uv) * vec4f(factors[${StandardMaterialFactorsStartPoint.DIFFUSE}], factors[${StandardMaterialFactorsStartPoint.DIFFUSE + 1}], factors[${StandardMaterialFactorsStartPoint.DIFFUSE + 2}], factors[${StandardMaterialFactorsStartPoint.DIFFUSE + 3}])` : `vec4f(factors[${StandardMaterialFactorsStartPoint.DIFFUSE}], factors[${StandardMaterialFactorsStartPoint.DIFFUSE + 1}], factors[${StandardMaterialFactorsStartPoint.DIFFUSE + 2}], factors[${StandardMaterialFactorsStartPoint.DIFFUSE + 3}])`}
                `};

                
                var metallic  = 0.;
                var roughness = 0.;
                ${workFlow === "metallic_roughness" ? `
                    ${dataMap.get(RenderFlag.METALLIC)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.METALLIC]) ? `let metallicRoughness = textureSample(metallicRoughnessTexture, textureSampler, in.uv);` : ``}
                    metallic  = ${dataMap.get(RenderFlag.METALLIC)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.METALLIC]) ? `metallicRoughness.b * factors[${StandardMaterialFactorsStartPoint.METALLIC}];` : `factors[${StandardMaterialFactorsStartPoint.METALLIC}];`}
                    roughness  = ${dataMap.get(RenderFlag.ROUGHNESS)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.ROUGHNESS]) ? `metallicRoughness.g * factors[${StandardMaterialFactorsStartPoint.ROUGHNESS}];` : `factors[${StandardMaterialFactorsStartPoint.ROUGHNESS}];`}
                    metallic = clamp(metallic, 0.0, 1.0);
                    roughness = clamp(roughness, 0.04, 1.0);
                ` : `
                    let specularGlossiness=${dataMap.get(RenderFlag.PBR_SPECULAR)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.PBR_SPECULAR]) ? `textureSample(specularGlossinessTexture, textureSampler, in.uv) * vec4f(factors[${StandardMaterialFactorsStartPoint.PBR_SPECULAR}],factors[${StandardMaterialFactorsStartPoint.PBR_SPECULAR + 1}],factors[${StandardMaterialFactorsStartPoint.PBR_SPECULAR + 2}],factors[${StandardMaterialFactorsStartPoint.PBR_SPECULAR + 3}])` : `vec4f(factors[${StandardMaterialFactorsStartPoint.PBR_SPECULAR}],factors[${StandardMaterialFactorsStartPoint.PBR_SPECULAR + 1}],factors[${StandardMaterialFactorsStartPoint.PBR_SPECULAR + 2}],factors[${StandardMaterialFactorsStartPoint.PBR_SPECULAR + 3}])`};
                    roughness = 1. - specularGlossiness.a;
                `}
                

                let worldPosition=in.worldPos;
                let v=normalize(cameraPosition - worldPosition);
                var n=normalize(in.normal);
                ${canUseNormalMap ? `
                    let TBN = mat3x3<f32>(in.T, in.B, in.normal);
                    let mapNormal = textureSample(normalTexture, textureSampler, in.uv) * factors[${StandardMaterialFactorsStartPoint.NORMAL}] * 2.0 - 1.0;
                    n = normalize(TBN * mapNormal.xyz);
                ` : ""}       
                ${workFlow === "metallic_roughness" ? `
                    var f0 = specularColor * specularF0; 
                    f0 = mix(f0, albedo.xyz, metallic);
                ` : `
                    var f0 = specularGlossiness.xyz; 
                `}
                let r = reflect(-v, n);  
                var Lo = vec3(0.0);
                let NoV=clamp(dot(n,v),0.,1.);
                ${hasAnisotropy ? `
                ${canUseNormalMap ? ``:`let TBN = mat3x3<f32>(in.T, in.B, in.normal);`}
                let anisotropicT = normalize(TBN * vec3(direction, 0.0));
                let anisotropicB = normalize(cross(n, anisotropicT));
                ` : ``}
                ${hasClearcoat ? `
                    var Nc=n;
                    ${hasClearcoatNormal && canUseNormalMap ? `
                        let clearcoatNormalMap = textureSample(clearcoatNormalTexture, textureSampler, in.uv) * factors[${StandardMaterialFactorsStartPoint.CLEARCOAT_NORMAL}] * 2.0 - 1.0;
                        Nc = normalize(TBN * clearcoatNormalMap.xyz);
                    ` : ''}    
                    let NCdotV=clamp(dot(Nc,v),0.,1.);
                    let F0C=vec3(0.04);
                    let Rc=reflect(-v, Nc);
                    for (var i:u32 = 0; i < lightCounts.directional; i++) {
                        let l = normalize(dLights[i].position - worldPosition);
                        let h = normalize(v + l);
                        let HoV=clamp(dot(h,v),0.,1.);
                        let NoL=clamp(dot(Nc,l),0.,1.);
                        
                        let radiance = dLights[i].color * dLights[i].intensity;
    
                        
                        let D=distributionGGX(Nc,h,clearcoatRoughness);
                        let G=geometrySmith(Nc,v,l,clearcoatRoughness);
                        let F=fresnelSchlick(HoV,F0C);
    
                        let neom=D*F*G;
                        let denom=4 * NoL * NCdotV + 0.0001;
                        let specular=neom / denom * factors[${StandardMaterialFactorsStartPoint.CLEARCOAT}] * .25;
                        
    
                        Lo += (specular) * radiance  * NoL; 
                    }
                    let clearcoatIbl=getClearcoatIBL(NCdotV,F0C,clearcoatRoughness,Nc,v,r,clearcoat);
                    Lo+=clearcoatIbl.specular;
                    emissive *=clearcoatIbl.emissionMultiplier;
                ` : ''}
               
                for (var i:u32 = 0; i < lightCounts.directional; i++) {
                    let l = normalize(dLights[i].position - worldPosition);
                    let h = normalize(v + l);
                    let HoV=clamp(dot(h,v),0.,1.);
                    let NoL=clamp(dot(n,l),0.,1.);
                    
                    let radiance = dLights[i].color * dLights[i].intensity;

                    ${hasAnisotropy ? `
                    let NoH=dot(n,h);
                    let NoV=dot(v,h);
                    let ToL = dot(anisotropicT, l);
                    let BoL = dot(anisotropicB, l);
                    let ToH = dot(anisotropicT, h);
                    let BoH = dot(anisotropicB, h);
                    let BoV = dot(anisotropicB, v);
                    let ToV = dot(anisotropicT, v);
                    let specularAnisotropicOutput=BRDF_specularAnisotropicGGX(f0, vec3f(1.), roughness,HoV, NoL, NoV, NoH,BoV, ToV, ToL, BoL, ToH, BoH, anisotropy);
                    let F=specularAnisotropicOutput.F;
                    let specular=specularAnisotropicOutput.F * specularAnisotropicOutput.V * specularAnisotropicOutput.D;
                    let Ks=F;
                    var Kd=vec3f(1.) - metallic;
                    Kd *= 1. - Ks;
                    `: `               
                    let D=distributionGGX(n,h,roughness);
                    let G=geometrySmith(n,v,l,roughness);
                    let F=fresnelSchlick(HoV,f0);
                    
                    let Ks=F;
                    var Kd=vec3f(1.) - metallic;
                    Kd *= 1. - Ks;
                    
                    let neom=D*F*G;
                    let denom=4 * NoL * NoV + 0.0001;
                    let specular=neom / denom;
                    `}
                    

                    Lo += (Kd * albedo.xyz / PI + specular) * radiance  * NoL; 
                }
                                
                for (var i:u32 = 0; i < lightCounts.ambient; i++) {
                    let F        = fresnelSchlickRoughness(NoV, f0, roughness);
                    let kS       = F;
                    let kD       = (1.0 - kS) * (1.0 - metallic);
                    let Li=aLights[i].color * aLights[i].intensity;
                    Lo += kD * albedo.xyz / PI * Li;
                }
                
                ${hasAnisotropy ? `
                    var bentNormal = cross(anisotropicB, v);
                    bentNormal = normalize(cross(bentNormal, anisotropicB));
                    let a = pow(pow(1.0 - anisotropy * (1.0 - roughness),2),2);
                    bentNormal = normalize(mix(bentNormal, n, a));
                    var reflectVec = reflect(-v, bentNormal);
                    reflectVec = normalize(mix(reflectVec, bentNormal, roughness * roughness));
                    Lo += getIBL(NoV, f0, roughness,metallic,n,v,reflectVec,albedo.xyz,ao);
                `:`
                    Lo+=getIBL(NoV,f0,roughness,metallic,n,v,r,albedo.xyz,ao);
                `}
                var color=Lo;
                color +=emissive.xyz;
                
                color=applyExposure(color,EXPOSURE);
                ${TONE_MAPPING_CALL}
                color = applyGamma(color,2.2); 

                return vec4f(vec3f(color),1.);
            }
        `
    }

}