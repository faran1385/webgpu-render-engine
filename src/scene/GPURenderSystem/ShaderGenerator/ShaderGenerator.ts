import {fragmentMap} from "../SmartRender/shaderCodes.ts";
import {
    PBRBindPoint,
    PipelineShaderLocations,
    RenderFlag
} from "../MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";
import {Primitive} from "../../primitive/Primitive.ts";


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
            const PI=3.14159265359;
            
            fn D_GGX(NoH:f32,  a:f32)->f32 {
                let a2 = a * a;
                let f = (NoH * a2 - NoH) * NoH + 1.0;
                return a2 / (PI * f * f);
            }
            
            fn F_Schlick(u:f32, f0:vec3f)->vec3f {
                return f0 + (vec3(1.0) - f0) * pow(1.0 - u, 5.0);
            }
            
            fn V_SmithGGXCorrelated(NoV:f32, NoL:f32, a:f32)->f32 {
                let a2 = a * a;
                let GGXL = NoV * sqrt((-NoL * a2 + NoL) * NoL + a2);
                let GGXV = NoL * sqrt((-NoV * a2 + NoV) * NoV + a2);
                return 0.5 / (GGXV + GGXL);
            }
            
            fn Fd_Lambert()->f32 {
                return 1.0 / PI;
            }
                        
            @fragment fn fs(in: vsOut) -> @location(0) vec4f {
                // --- Sample textures & factors ---
                let baseColor = ${dataMap.get(RenderFlag.BASE_COLOR)?.texture ? `textureSample(baseColorTexture, textureSampler, in.uv)
                                * vec4f(factors[0], factors[1], factors[2], factors[3])` : "vec4f(factors[0], factors[1], factors[2], factors[3])"};
                ${dataMap.get(RenderFlag.METALLIC)?.texture ? `let metallicRoughness = textureSample(metallicRoughnessTexture, textureSampler, in.uv);` : ``}
                var metallic  = ${dataMap.get(RenderFlag.METALLIC)?.texture ? `metallicRoughness.b * factors[7];` : `factors[7];`}
                var ao  = ${dataMap.get(RenderFlag.OCCLUSION)?.texture ? `textureSample(occlusionTexture,textureSampler,in.uv).r * factors[10];` : `factors[10];`}
                var emissive  = ${dataMap.get(RenderFlag.EMISSIVE)?.texture ? `textureSample(emissiveTexture,textureSampler,in.uv);` : `vec3f(factors[4], factors[5], factors[6]);`}
                var roughness  = ${dataMap.get(RenderFlag.ROUGHNESS)?.texture ? `metallicRoughness.g * factors[8];` : `factors[8];`}
                roughness = clamp(roughness, 0.089, 1.0);
                
                // variables
                let reflectance=2.;
                let N=in.normal;
                let f0 = 0.16 * reflectance * reflectance * (1.0 - metallic) + baseColor.xyz * metallic;
                let V=normalize(cameraPosition - in.worldPos);
                let NoV = max(dot(N, V), 0.0001);
                let a=roughness * roughness;                
                var color=vec3f(0);
                
                for(var i=0;i < i32(lightCounts.directionalCount);i++){
                    let lightColor=dLights[i].color * dLights[i].intensity;
                    let lightPos=dLights[i].position;
                    let L=normalize(lightPos - in.worldPos);
                    let H = normalize(V + L);
                    
                    let NoL = max(dot(N, L), 0.0);
                    let NoH = max(dot(N, H), 0.0);
                    let LoH = max(dot(L, H), 0.0);
                          
                    let D = D_GGX(NoH, a);
                    let  F = F_Schlick(LoH, f0);
                    let G = V_SmithGGXCorrelated(NoV, NoL, roughness);
                    
                    // specular BRDF
                    let Fr = (D * G) * F;        
                            
                    // diffuse BRDF
                    let kd = (1.0 - F) * (1.0 - metallic);
                    let Fd = baseColor.rgb * kd / PI;
    
                    color = color + (Fd + Fr) * lightColor * NoL;
                }
                color *=ao;
                color +=emissive;
                return vec4f(vec3f(color),1.);
            }

        `
    }

}