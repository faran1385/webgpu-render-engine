import {
    StandardMaterialBindPoint,
    PipelineShaderLocations,
    RenderFlag
} from "../MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";
import {Primitive} from "../../primitive/Primitive.ts";
import {
    distributionGGX,
    fresnelSchlick,
    fresnelSchlickRoughness,
    geometrySmith
} from "../../../helpers/pbrShaderFunctions.ts";
import {
    EXPOSURE,
    GAMMA_CORRECTION,
    TONE_MAPPING, TONE_MAPPING_CALL
} from "../../../helpers/postProcessUtils/postProcessUtilsShaderCodes.ts";


export class ShaderGenerator {

    baseVertex(hasBoneData: boolean, hasTexture: boolean, hasNormal: boolean, useNormalMap: boolean): string {
        return `
struct vsIn {
    @location(${PipelineShaderLocations.POSITION}) pos: vec3f,
    ${hasTexture ? `@location(${PipelineShaderLocations.UV}) uv: vec2f,` : ""}
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
    ${hasTexture ? `@location(0) uv: vec2f,` : ""}
    ${hasTexture ? `@location(2) normal: vec3f,` : ""}
    ${useNormalMap ?
            `@location(3) TBN0: vec3f,
             @location(4) TBN1: vec3f,
             @location(5) TBN2: vec3f,`
            : ""}
    @location(1) worldPos:vec3f,
};

@group(0) @binding(0) var<uniform> projectionMatrix: mat4x4<f32>;
@group(0) @binding(1) var<uniform> viewMatrix: mat4x4<f32>;
${!hasBoneData ? "@group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;" : ""}

${hasBoneData ? `@group(2) @binding(1) var<storage, read> jointsMatrices: array<mat4x4<f32>>;` : ""}

${hasBoneData ? `
fn skinMat(pos : vec4<f32>) -> vec4<f32> {
  return jointMats[0] * pos * in.weights.x +
         jointMats[1] * pos * in.weights.y +
         jointMats[2] * pos * in.weights.z +
         jointMats[3] * pos * in.weights.w;
}
` : ''}
@vertex
fn vs(in: vsIn) -> vsOut {
    var output: vsOut;

    ${hasBoneData ? `
        let joint0 = jointsMatrices[in.joints.x];
        let joint1 = jointsMatrices[in.joints.y];
        let joint2 = jointsMatrices[in.joints.z];
        let joint3 = jointsMatrices[in.joints.w];
    ` : ""}

    let pos = vec4f(in.pos, 1.0);

    ${hasBoneData ? `let skinnedPos : vec4<f32> = skinMat(vec4<f32>(in.position, 1.0));` : ""}
    ${!hasBoneData ? `var worldPos = modelMatrix * pos;` : ""}
    ${hasBoneData ? `
        output.clipPos = projectionMatrix * viewMatrix * skinnedPos;
    
    ` : `
        output.clipPos = projectionMatrix * viewMatrix * worldPos;
    `}
    ${hasTexture ? `output.uv = in.uv;` : ""}
    ${hasNormal ? `output.normal = in.normal;` : ""}
    ${useNormalMap ? hasBoneData ? `
        let skinnedN : vec3<f32> = (skinMat(vec4<f32>(in.normal, 0.0))).xyz;
        let skinnedT : vec3<f32> = (skinMat(vec4<f32>(in.tangent.xyz, 0.0))).xyz;
        let handedness : f32    = in.tangent.w;
        let N = normalize(skinnedN);
        let T = normalize(skinnedT);
        
        let B = cross(N, T) * handedness;
        
        output.TBN0 = T;
        output.TBN1 = B;
        output.TBN2 = N;
    ` : `
        let T = normalize((modelMatrix * vec4(in.tangent.xyz, 0.0)).xyz);
        let N = normalize((modelMatrix * vec4(in.normal, 0.0)).xyz);
        let B = cross(N, T) * in.tangent.w;
        output.TBN0 = T;
        output.TBN1 = B;
        output.TBN2 = N;
    ` : ""}
    ${hasBoneData ? `
        output.worldPos = skinned.xyz;
    ` : `
        output.worldPos = worldPos.xyz;
    `}
    return output;
}`
    }

    getStandardCode(primitive: Primitive) {
        const dataMap = primitive.material.textureDataMap
        const hasBoneData = Boolean(primitive.geometry.dataList.get('JOINTS_0') && primitive.geometry.dataList.get("WEIGHTS_0"))
        const hasNormal = Boolean(primitive.geometry.dataList.get('NORMAL'))
        const canNormalMap = Boolean(primitive.material.textureDataMap.get(RenderFlag.NORMAL)?.texture && primitive.geometry.dataList.has("NORMAL") && primitive.geometry.dataList.has("TANGENT"))

        const generatedVertexCode = this.baseVertex(hasBoneData, true, hasNormal, canNormalMap)

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
            ${dataMap.get(RenderFlag.EMISSIVE)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.EMISSIVE]) ? `@group(1) @binding(${StandardMaterialBindPoint.EMISSIVE}) var emissiveTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.METALLIC)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.METALLIC]) ? `@group(1) @binding(${StandardMaterialBindPoint.METALLIC}) var metallicRoughnessTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.NORMAL)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.NORMAL]) ? `@group(1) @binding(${StandardMaterialBindPoint.NORMAL}) var normalTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.OCCLUSION)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.OCCLUSION]) ? `@group(1) @binding(${StandardMaterialBindPoint.OCCLUSION}) var occlusionTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.SPECULAR)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.SPECULAR]) ? `@group(1) @binding(${StandardMaterialBindPoint.SPECULAR})  var specularTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.SPECULAR_COLOR)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.SPECULAR_COLOR]) ? `@group(1) @binding(${StandardMaterialBindPoint.SPECULAR_COLOR})  var specularColorTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.TRANSMISSION)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.TRANSMISSION]) ? `@group(1) @binding(${StandardMaterialBindPoint.TRANSMISSION})  var transmissionTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.CLEARCOAT)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.CLEARCOAT]) ? `@group(1) @binding(${StandardMaterialBindPoint.CLEARCOAT}) var clearcoatTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.CLEARCOAT_ROUGHNESS)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.CLEARCOAT_ROUGHNESS]) ? `@group(1) @binding(${StandardMaterialBindPoint.CLEARCOAT_ROUGHNESS}) var clearcoatRoughness:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.CLEARCOAT_NORMAL)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.CLEARCOAT_NORMAL]) ? `@group(1) @binding(${StandardMaterialBindPoint.CLEARCOAT_NORMAL}) var clearcoatNormalTexture:texture_2d<f32>;` : ""}
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
            
            override TONE_MAPPING_NUMBER = 0;
            override EXPOSURE = 0.;
            override ALPHA_MODE = 0;
            override ALPHA_CUTOFF = 0;
            
            
            fn getIBL(NoV:f32,f0:vec3f,roughness:f32,metallic:f32,n:vec3f,v:vec3f,r:vec3f,albedo:vec3f,ao:f32)->vec3f{
                let irradiance = textureSample(irradianceMap, iblSampler, n).xyz;  
                let envBRDF  = textureSample(brdfLUT,iblSampler, vec2f(max(dot(n, v), 0.0), roughness)).rg;
                let prefilteredColor = textureSampleLevel(prefilterMap,iblSampler, r,  roughness * MAX_REFLECTION_LOD).rgb; 
                let F = fresnelSchlickRoughness(NoV, f0,roughness);
                let kS = F;
                var kD = 1.0 - kS;
                kD *= 1.0 - metallic;
            
                let diffuse=irradiance * albedo.xyz * kD;
                let specular = prefilteredColor * (F * envBRDF.x + envBRDF.y);
                
                return (diffuse + specular) * ao;
            }
            
            @fragment fn fs(in: vsOut) -> @location(0) vec4f {
                var ao  = ${dataMap.get(RenderFlag.OCCLUSION)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.OCCLUSION]) ? `textureSample(occlusionTexture,textureSampler,in.uv).r * factors[10];` : `factors[10];`}
                var emissive  = ${dataMap.get(RenderFlag.EMISSIVE)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.EMISSIVE]) ? `textureSample(emissiveTexture,textureSampler,in.uv).rgb * vec3f(factors[4],factors[5],factors[6]);` : `vec3f(factors[4],factors[5],factors[6]);`}
                var albedo = ${dataMap.get(RenderFlag.BASE_COLOR)?.texture  || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.BASE_COLOR])? `textureSample(baseColorTexture, textureSampler, in.uv) * vec4f(factors[0], factors[1], factors[2], factors[3])` : "vec4f(factors[0], factors[1], factors[2], factors[3])"};
                ${dataMap.get(RenderFlag.METALLIC)?.texture  || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.METALLIC])? `let metallicRoughness = textureSample(metallicRoughnessTexture, textureSampler, in.uv);` : ``}
                var metallic  = ${dataMap.get(RenderFlag.METALLIC)?.texture  || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.METALLIC])? `metallicRoughness.b * factors[7];` : `factors[7];`}
                var roughness  = ${dataMap.get(RenderFlag.ROUGHNESS)?.texture || primitive.material.resources.get(StandardMaterialBindPoint[StandardMaterialBindPoint.ROUGHNESS]) ? `metallicRoughness.g * factors[8];` : `factors[8];`}
                metallic = clamp(metallic, 0.0, 1.0);
                roughness = clamp(roughness, 0.04, 1.0);

                let worldPosition=in.worldPos;
                let v=normalize(cameraPosition - worldPosition);
                var n=normalize(in.normal);
                ${canNormalMap ? `
                    let TBN = mat3x3<f32>(in.TBN0, in.TBN1, in.TBN2);
                    let mapNormal = textureSample(normalTexture, textureSampler, in.uv) * 2.0 - 1.0;
                    n = normalize(TBN * mapNormal.xyz);
                ` : ""}           
                var f0 = vec3(0.04); 
                f0 = mix(f0, albedo.xyz, metallic); 
                let r = reflect(-v, n);  
                var Lo = vec3(0.0);
                let NoV=max(dot(n,v),0.);
                for (var i:u32 = 0; i < lightCounts.directional; i++) {
                    let l = normalize(dLights[i].position - worldPosition);
                    let h = normalize(v + l);
                    let HoV=max(dot(h,v),0.);
                    let NoL=max(dot(n,l),0.);
                    
                    let radiance = dLights[i].color * dLights[i].intensity;

                    
                    let D=distributionGGX(n,h,roughness);
                    let G=geometrySmith(n,v,l,roughness);
                    let F=fresnelSchlick(HoV,f0);
                    
                    let Ks=F;
                    var Kd=vec3f(1.) - metallic;
                    Kd *= 1. - Ks;
                    
                    let neom=D*F*G;
                    let denom=4 * NoL * NoV + 0.0001;
                    let specular=neom / denom;
                    

                    Lo += (Kd * albedo.xyz / PI + specular) * radiance  * NoL; 
                }
                                
                for (var i:u32 = 0; i < lightCounts.ambient; i++) {
                    let F        = fresnelSchlickRoughness(NoV, f0, roughness);
                    let kS       = F;
                    let kD       = (1.0 - kS) * (1.0 - metallic);
                    let Li=aLights[i].color * aLights[i].intensity;
                    Lo += kD * albedo.xyz / PI * Li;
                }
                
                Lo+=getIBL(NoV,f0,roughness,metallic,n,v,r,albedo.xyz,ao);
                
                var color=Lo;
                color=applyExposure(color,EXPOSURE);
                ${TONE_MAPPING_CALL}
                color = applyGamma(color,2.2); 
                return vec4f(vec3f(color),1.);
            }

        `
    }

}