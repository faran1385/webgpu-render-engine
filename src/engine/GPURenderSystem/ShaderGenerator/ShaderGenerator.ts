import {fragmentMap} from "../SmartRender/shaderCodes.ts";
import {
    PBRBindPoint,
    PipelineShaderLocations,
    RenderFlag
} from "../MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";
import {Primitive} from "../../primitive/Primitive.ts";
import {
    distributionGGX,
    fresnelSchlick, fresnelSchlickRoughness,
    geometrySchlickGGX,
    geometrySmith
} from "../../../helpers/pbrShaderFunctions.ts";
import {postProcessUtilsMap} from "../../postProcessUtils/postProcessUtilsShaderCodes.ts";
import {PostProcessUtils} from "../../postProcessUtils/postProcessUtilsTypes.ts";


export class ShaderGenerator {

    baseVertex(hasBoneData: boolean, hasTexture: boolean, hasNormal: boolean): string {
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
};

struct vsOut {
    @builtin(position) clipPos: vec4f,
    ${hasTexture ? `@location(0) uv: vec2f,` : ""}
    ${hasTexture ? `@location(2) normal: vec3f,` : ""}
    @location(1) worldPos:vec3f,
};

@group(0) @binding(0) var<uniform> projectionMatrix: mat4x4<f32>;
@group(0) @binding(1) var<uniform> viewMatrix: mat4x4<f32>;
${!hasBoneData ? "@group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;" : ""}

${hasBoneData ? `@group(2) @binding(1) var<storage, read> jointsMatrices: array<mat4x4<f32>>;` : ""}
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

    ${hasBoneData ? `
        let skinned =
        (joint0 * pos) * in.weights.x +
        (joint1 * pos) * in.weights.y +
        (joint2 * pos) * in.weights.z +
        (joint3 * pos) * in.weights.w;
    ` : ""}
    ${!hasBoneData ? `var worldPos = modelMatrix * pos;` : ""}
    ${hasBoneData ? `
        output.clipPos = projectionMatrix * viewMatrix * skinned;
    
    ` : `
        output.clipPos = projectionMatrix * viewMatrix * worldPos;
    `}
    ${hasTexture ? `output.uv = in.uv;` : ""}
    ${hasNormal ? `output.normal = in.normal;` : ""}
    ${hasBoneData ? `
        output.worldPos = skinned.xyz;
    ` : `
        output.worldPos = worldPos.xyz;
    `}
    return output;
}`
    }

    getInspectCode(primitive: Primitive, renderFlag: RenderFlag) {
        const hasTexture = Boolean(primitive.material.textureMap.get(renderFlag)?.texture);
        const hasBoneData = Boolean(primitive.geometry.dataList.get('JOINTS_0') && primitive.geometry.dataList.get("WEIGHTS_0"))

        const generatedVertexCode = this.baseVertex(hasBoneData, hasTexture, false)
        const generatedFragmentCode = fragmentMap.get(renderFlag);
        if (!generatedFragmentCode) throw new Error("Shader key not found");

        let value = generatedFragmentCode[hasTexture ? 0 : 1]

        return generatedVertexCode + '\n' + value
    }

    getPBRCode(primitive: Primitive) {
        const dataMap = primitive.material.textureMap
        const hasBoneData = Boolean(primitive.geometry.dataList.get('JOINTS_0') && primitive.geometry.dataList.get("WEIGHTS_0"))

        const hasNormal = Boolean(primitive.geometry.dataList.get('NORMAL'))
        const generatedVertexCode = this.baseVertex(hasBoneData, true, hasNormal)

        return generatedVertexCode + '\n' + `
            struct DLight {
                color: vec3f,
                intensity: f32,
                position: vec3f,
                _pad: f32, 
            };
            
            struct PLight {
                color: vec3f,
                intensity: f32,
                position: vec3f,
                decay: f32,
            };
            
            struct LightCounts {
                directionalCount: u32,
                pointCount: u32,
                _pad: vec2u, 
            };
        
            @group(0) @binding(6) var<storage, read> pLights: array<PLight>;
            @group(0) @binding(7) var<storage, read> dLights: array<DLight>;
            @group(0) @binding(8) var<uniform> lightCounts: LightCounts;
            @group(0) @binding(9) var brdfLUT:texture_2d<f32>;
            @group(0) @binding(10) var prefilterMap:texture_cube<f32>;
            @group(0) @binding(11) var irradianceMap:texture_cube<f32>;
            @group(0) @binding(12) var iblSampler:sampler;

            @group(1) @binding(0) var textureSampler:sampler;
            @group(1) @binding(1) var<uniform> alphaMode:vec2f;
            @group(1) @binding(2) var<storage,read> factors:array<f32>;
            ${dataMap.get(RenderFlag.BASE_COLOR)?.texture ? `@group(1) @binding(${PBRBindPoint.BASE_COLOR}) var baseColorTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.EMISSIVE)?.texture ? `@group(1) @binding(${PBRBindPoint.EMISSIVE}) var emissiveTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.METALLIC)?.texture ? `@group(1) @binding(${PBRBindPoint.METALLIC_ROUGHNESS}) var metallicRoughnessTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.NORMAL)?.texture ? `@group(1) @binding(${PBRBindPoint.NORMAL}) var normalTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.OCCLUSION)?.texture ? `@group(1) @binding(${PBRBindPoint.OCCLUSION}) var occlusionTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.SPECULAR)?.texture ? `@group(1) @binding(${PBRBindPoint.SPECULAR})  var specularTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.SPECULAR_COLOR)?.texture ? `@group(1) @binding(${PBRBindPoint.SPECULAR_COLOR})  var specularColorTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.TRANSMISSION)?.texture ? `@group(1) @binding(${PBRBindPoint.TRANSMISSION})  var transmissionTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.CLEARCOAT)?.texture ? `@group(1) @binding(${PBRBindPoint.CLEARCOAT}) var clearcoatTexture:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.CLEARCOAT_ROUGHNESS)?.texture ? `@group(1) @binding(${PBRBindPoint.CLEARCOAT_ROUGHNESS}) var clearcoatRoughness:texture_2d<f32>;` : ""}
            ${dataMap.get(RenderFlag.CLEARCOAT_NORMAL)?.texture ? `@group(1) @binding(${PBRBindPoint.CLEARCOAT_NORMAL}) var clearcoatNormalTexture:texture_2d<f32>;` : ""}
            @group(0) @binding(4) var<uniform> cameraPosition:vec3f;
            
            const PI = 3.14159265359;

            ${distributionGGX}
            ${geometrySchlickGGX}
            ${geometrySmith}
            ${fresnelSchlick}
            ${fresnelSchlickRoughness}
            ${postProcessUtilsMap.get(PostProcessUtils.GAMMA_CORRECTION)}
            const MAX_REFLECTION_LOD = 4.0;
                        
            @fragment fn fs(in: vsOut) -> @location(0) vec4f {
                var ao  = ${dataMap.get(RenderFlag.OCCLUSION)?.texture ? `textureSample(occlusionTexture,textureSampler,in.uv).r * factors[10];` : `factors[10];`}
                let albedo = ${dataMap.get(RenderFlag.BASE_COLOR)?.texture ? `textureSample(baseColorTexture, textureSampler, in.uv) * vec4f(factors[0], factors[1], factors[2], factors[3])` : "vec4f(factors[0], factors[1], factors[2], factors[3])"};
                ${dataMap.get(RenderFlag.METALLIC)?.texture ? `let metallicRoughness = textureSample(metallicRoughnessTexture, textureSampler, in.uv);` : ``}
                var metallic  = ${dataMap.get(RenderFlag.METALLIC)?.texture ? `metallicRoughness.b * factors[7];` : `factors[7];`}
                var roughness  = ${dataMap.get(RenderFlag.ROUGHNESS)?.texture ? `metallicRoughness.g * factors[8];` : `factors[8];`}
                roughness = clamp(0., 0.089, 1.0);
                metallic=0.;
                
                let worldPosition=in.worldPos;
                let n = normalize(in.normal);
                let v = normalize(cameraPosition - worldPosition);
                let r = reflect(-v, n);
                
                let f0 = mix(vec3f(0.04), albedo.xyz, metallic);

                var lo = vec3f(0.0);
                
                for (var i:u32 = 0; i < lightCounts.directionalCount; i++) {
                    let l = normalize(dLights[i].position - worldPosition);
                    let h = normalize(v + l);
                    
                    let distance = length(dLights[i].position - worldPosition);
                    let attenuation = 1.0 / (distance * distance);
                    let radiance = (dLights[i].color * dLights[i].intensity) * attenuation;
                    
                    let d = distributionGGX(n, h, roughness);
                    let g = geometrySmith(n, v, l, roughness);
                    let f = fresnelSchlick(max(dot(h, v), 0.0), f0);
                    
                    let numerator = d * g * f;
                    let denominator = 4.0 * max(dot(n, v), 0.0) * max(dot(n, l), 0.0) + 0.00001;
                    let specular = numerator / denominator;
                    
                    let kS = f;
                    var kD = vec3f(1.0) - kS;
                    kD *= 1.0 - metallic;
                    
                    let nDotL = max(dot(n, l), 0.00001);
                    lo += (kD * albedo.xyz / PI + specular) * radiance * nDotL;
                }
                
                let f = fresnelSchlickRoughness(max(dot(n, v), 0.00001), f0, roughness);
                let kS = f;
                var kD = vec3f(1.0) - kS;
                kD *= 1.0 - metallic;
                
                let irradiance = textureSample(irradianceMap, iblSampler, n).rgb;
                let diffuse = irradiance * albedo.xyz;
                
                let prefilteredColor = textureSampleLevel(prefilterMap, iblSampler, r, roughness * MAX_REFLECTION_LOD).rgb;
                let brdf = textureSample(brdfLUT, iblSampler, vec2f(max(dot(n, v), 0.0), roughness)).rg;
                let specular = prefilteredColor * (f * brdf.x + brdf.y);
                
                let ambient = (kD * diffuse + specular) * ao;

                var color = ambient + lo;
                color = applyGamma(color,1);

                return vec4f(vec3f(color),1.);
            }

        `
    }

}