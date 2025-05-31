import {DecodedMaterialFlags, ResourcesBindingPoints} from "../loader/loaderTypes.ts";

export type DetermineShaderCode = {
    isBase: boolean,
    hasUv: boolean,
    isOcclusion: boolean,
    isEmissive: boolean,
    isNormal: boolean,
    isMetallic: boolean,
    isRoughness: boolean,
    isTransmission: boolean,
    isSpecular: boolean,
    isOpacity: boolean,
    isGlossiness: boolean,
    isSpecularGlossiness: boolean,
    isSpecularColor: boolean,
    decodedMaterial: DecodedMaterialFlags,

}
export const determineShaderCode = (
    {
        isEmissive,
        isNormal,
        isOcclusion,
        isBase,
        hasUv,
        decodedMaterial,
        isGlossiness,
        isSpecular,
        isTransmission,
        isSpecularColor,
        isSpecularGlossiness,
        isMetallic,
        isOpacity,
        isRoughness
    }: DetermineShaderCode
): string => {
    let shaderCode = ''

    if (isOpacity) {
        shaderCode = `
                struct vsIn{
                    @location(0) pos:vec3f,
                    ${hasUv ? '@location(1) uv:vec2f' : ''}
                }
                struct vsOut{
                    @builtin(position) clipPos:vec4f,
                    ${hasUv ? '@location(0) uv:vec2f' : ''}
                }
                @group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
                @group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
                @group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;
                @vertex fn vs(in:vsIn)->vsOut{
                    var output:vsOut;
                    var worldPos = modelMatrix * vec4f(in.pos, 1);
                    output.clipPos = projectionMatrix * viewMatrix * worldPos;
                    ${hasUv ? 'output.uv=in.uv;' : ''}
                    return output;
                }
                
                @group(1) @binding(${ResourcesBindingPoints.FACTORS}) var<storage,read> factors:array<f32>; 
                ${decodedMaterial.hasBaseColorTexture ? `@group(1) @binding(${ResourcesBindingPoints.BASE_COLOR_TEXTURE}) var targetTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let colorFactor=vec4f(factors[0],factors[1],factors[2],factors[3]);
                    ${decodedMaterial.hasBaseColorTexture ? 'var model=textureSample(targetTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasBaseColorTexture ? 'model=model * colorFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasBaseColorTexture ? 'model.a' : 'colorFactor.a'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    return vec4f(vec3f(alpha),1.);
                }
            `
    } else if (isBase) {
        shaderCode = `
                struct vsIn{
                    @location(0) pos:vec3f,
                    ${hasUv ? '@location(1) uv:vec2f' : ''}
                }
                struct vsOut{
                    @builtin(position) clipPos:vec4f,
                    ${hasUv ? '@location(0) uv:vec2f' : ''}
                }
                @group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
                @group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
                @group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;
                @vertex fn vs(in:vsIn)->vsOut{
                    var output:vsOut;
                    var worldPos = modelMatrix * vec4f(in.pos, 1);
                    output.clipPos = projectionMatrix * viewMatrix * worldPos;
                    ${hasUv ? 'output.uv=in.uv;' : ''}
                    return output;
                }
                
                @group(1) @binding(${ResourcesBindingPoints.FACTORS}) var<storage,read> factors:array<f32>; 
                ${decodedMaterial.hasBaseColorTexture ? `@group(1) @binding(${ResourcesBindingPoints.BASE_COLOR_TEXTURE}) var targetTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let colorFactor=vec4f(factors[0],factors[1],factors[2],factors[3]);
                    ${decodedMaterial.hasBaseColorTexture ? 'var model=textureSample(targetTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasBaseColorTexture ? 'model=model * colorFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasBaseColorTexture ? 'model.a' : 'colorFactor.a'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasBaseColorTexture ? 'return vec4f(model.xyz,alpha);' : 'return vec4f(colorFactor.xyz,alpha);'}
                }
            `
    } else if (isEmissive) {

        shaderCode = `
                struct vsIn{
                    @location(0) pos:vec3f,
                    ${hasUv ? '@location(1) uv:vec2f' : ''}
                }
                struct vsOut{
                    @builtin(position) clipPos:vec4f,
                    ${hasUv ? '@location(0) uv:vec2f' : ''}
                }
                @group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
                @group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
                @group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;
                @vertex fn vs(in:vsIn)->vsOut{
                    var output:vsOut;
                    var worldPos = modelMatrix * vec4f(in.pos, 1);
                    output.clipPos = projectionMatrix * viewMatrix * worldPos;
                    ${hasUv ? 'output.uv=in.uv;' : ''}
                    return output;
                }
                
                @group(1) @binding(${ResourcesBindingPoints.FACTORS}) var<storage,read> factors:array<f32>; 
                ${decodedMaterial.hasEmissiveTexture ? `@group(1) @binding(${ResourcesBindingPoints.EMISSIVE_TEXTURE}) var targetTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let colorFactor=vec4f(vec3f(factors[4],factors[5],factors[6]) * factors[14],1.);
                    ${decodedMaterial.hasEmissiveTexture ? 'var model=textureSample(targetTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasEmissiveTexture ? 'model=model * colorFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasEmissiveTexture ? 'model.a' : 'colorFactor.a'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasEmissiveTexture ? 'return vec4f(model.xyz,alpha);' : 'return vec4f(colorFactor.xyz,alpha);'}
                }
            `
    } else if (isOcclusion) {

        shaderCode = `
                struct vsIn{
                    @location(0) pos:vec3f,
                    ${hasUv ? '@location(1) uv:vec2f' : ''}
                }
                struct vsOut{
                    @builtin(position) clipPos:vec4f,
                    ${hasUv ? '@location(0) uv:vec2f' : ''}
                }
                @group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
                @group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
                @group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;
                @vertex fn vs(in:vsIn)->vsOut{
                    var output:vsOut;
                    var worldPos = modelMatrix * vec4f(in.pos, 1);
                    output.clipPos = projectionMatrix * viewMatrix * worldPos;
                    ${hasUv ? 'output.uv=in.uv;' : ''}
                    return output;
                }
                
                @group(1) @binding(${ResourcesBindingPoints.FACTORS}) var<storage,read> factors:array<f32>; 
                ${decodedMaterial.hasOcclusionTexture ? `@group(1) @binding(${ResourcesBindingPoints.OCCLUSION_TEXTURE}) var targetTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let colorFactor=vec4f(vec3f(factors[7]),1);
                    ${decodedMaterial.hasOcclusionTexture ? 'var model=textureSample(targetTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasOcclusionTexture ? 'model=model * colorFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasOcclusionTexture ? 'model.a' : 'colorFactor.a'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasOcclusionTexture ? 'return vec4f(vec3f(model.r),alpha);' : 'return vec4f(colorFactor.xyz,alpha);'}
                }
            `
    } else if (isNormal) {
        shaderCode = `
                struct vsIn{
                    @location(0) pos:vec3f,
                    ${hasUv ? '@location(1) uv:vec2f' : ''}
                }
                struct vsOut{
                    @builtin(position) clipPos:vec4f,
                    ${hasUv ? '@location(0) uv:vec2f' : ''}
                }
                @group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
                @group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
                @group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;
                @vertex fn vs(in:vsIn)->vsOut{
                    var output:vsOut;
                    var worldPos = modelMatrix * vec4f(in.pos, 1);
                    output.clipPos = projectionMatrix * viewMatrix * worldPos;
                    ${hasUv ? 'output.uv=in.uv;' : ''}
                    return output;
                }
                
                @group(1) @binding(${ResourcesBindingPoints.FACTORS}) var<storage,read> factors:array<f32>; 
                ${decodedMaterial.hasNormalTexture ? `@group(1) @binding(${ResourcesBindingPoints.NORMAL_TEXTURE}) var targetTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let colorFactor=vec4f(vec3f(factors[8]),1);
                    ${decodedMaterial.hasNormalTexture ? 'var model=textureSample(targetTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasNormalTexture ? 'model=model * colorFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasNormalTexture ? 'model.a' : 'colorFactor.a'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasNormalTexture ? 'return vec4f(model.xyz,alpha);' : 'return vec4f(colorFactor.xyz,alpha);'}
                }
            `
    } else if (isMetallic || isRoughness) {

        shaderCode = `
                struct vsIn{
                    @location(0) pos:vec3f,
                    ${hasUv ? '@location(1) uv:vec2f' : ''}
                }
                struct vsOut{
                    @builtin(position) clipPos:vec4f,
                    ${hasUv ? '@location(0) uv:vec2f' : ''}
                }
                @group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
                @group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
                @group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;
                @vertex fn vs(in:vsIn)->vsOut{
                    var output:vsOut;
                    var worldPos = modelMatrix * vec4f(in.pos, 1);
                    output.clipPos = projectionMatrix * viewMatrix * worldPos;
                    ${hasUv ? 'output.uv=in.uv;' : ''}
                    return output;
                }
                
                @group(1) @binding(${ResourcesBindingPoints.FACTORS}) var<storage,read> factors:array<f32>; 
                ${decodedMaterial.hasMetallicRoughnessTex ? `@group(1) @binding(${ResourcesBindingPoints.METALLIC_ROUGHNESS_TEXTURE}) var targetTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let colorFactor=vec4f(vec3f(factors[${isMetallic ? 9 : 10}]),1);
                    ${decodedMaterial.hasMetallicRoughnessTex ? 'var model=textureSample(targetTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasMetallicRoughnessTex ? 'model=model * colorFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasMetallicRoughnessTex ? 'model.a' : 'colorFactor.a'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasMetallicRoughnessTex ? `return vec4f(vec3f(model.${isMetallic ? 'b' : 'g'}),alpha);` : 'return vec4f(colorFactor.xyz,alpha);'}
                }
            `
    } else if (isTransmission) {
        shaderCode = `
                struct vsIn{
                    @location(0) pos:vec3f,
                    ${hasUv ? '@location(1) uv:vec2f' : ''}
                }
                struct vsOut{
                    @builtin(position) clipPos:vec4f,
                    ${hasUv ? '@location(0) uv:vec2f' : ''}
                }
                @group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
                @group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
                @group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;
                @vertex fn vs(in:vsIn)->vsOut{
                    var output:vsOut;
                    var worldPos = modelMatrix * vec4f(in.pos, 1);
                    output.clipPos = projectionMatrix * viewMatrix * worldPos;
                    ${hasUv ? 'output.uv=in.uv;' : ''}
                    return output;
                }
                
                @group(1) @binding(${ResourcesBindingPoints.FACTORS}) var<storage,read> factors:array<f32>; 
                ${decodedMaterial.hasTransmissionTexture ? `@group(1) @binding(${ResourcesBindingPoints.TRANSMISSION_TEXTURE}) var targetTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let colorFactor=vec4f(vec3f(factors[11]),1);
                    ${decodedMaterial.hasTransmissionTexture ? 'var model=textureSample(targetTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasTransmissionTexture ? 'model=model * colorFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasTransmissionTexture ? 'model.a' : 'colorFactor.a'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasTransmissionTexture ? `return vec4f(model.xyz,alpha);` : 'return vec4f(colorFactor.xyz,alpha);'}
                }
            `
    } else if (isGlossiness) {
        shaderCode = `
                struct vsIn{
                    @location(0) pos:vec3f,
                    ${hasUv ? '@location(1) uv:vec2f' : ''}
                }
                struct vsOut{
                    @builtin(position) clipPos:vec4f,
                    ${hasUv ? '@location(0) uv:vec2f' : ''}
                }
                @group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
                @group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
                @group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;
                @vertex fn vs(in:vsIn)->vsOut{
                    var output:vsOut;
                    var worldPos = modelMatrix * vec4f(in.pos, 1);
                    output.clipPos = projectionMatrix * viewMatrix * worldPos;
                    ${hasUv ? 'output.uv=in.uv;' : ''}
                    return output;
                }
                
                @group(1) @binding(${ResourcesBindingPoints.FACTORS}) var<storage,read> factors:array<f32>; 
                ${decodedMaterial.hasGlossinessTexture ? `@group(1) @binding(${ResourcesBindingPoints.GLOSSINESS_TEXTURE}) var targetTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let colorFactor=vec4f(vec3f(factors[12]),1);
                    ${decodedMaterial.hasGlossinessTexture ? 'var model=textureSample(targetTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasGlossinessTexture ? 'model=model * colorFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasGlossinessTexture ? 'model.a' : 'colorFactor.a'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasGlossinessTexture ? `return vec4f(model.xyz,alpha);` : 'return vec4f(colorFactor.xyz,alpha);'}
                }
            `
    } else if (isSpecular) {
        shaderCode = `
                struct vsIn{
                    @location(0) pos:vec3f,
                    ${hasUv ? '@location(1) uv:vec2f' : ''}
                }
                struct vsOut{
                    @builtin(position) clipPos:vec4f,
                    ${hasUv ? '@location(0) uv:vec2f' : ''}
                }
                @group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
                @group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
                @group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;
                @vertex fn vs(in:vsIn)->vsOut{
                    var output:vsOut;
                    var worldPos = modelMatrix * vec4f(in.pos, 1);
                    output.clipPos = projectionMatrix * viewMatrix * worldPos;
                    ${hasUv ? 'output.uv=in.uv;' : ''}
                    return output;
                }
                
                @group(1) @binding(${ResourcesBindingPoints.FACTORS}) var<storage,read> factors:array<f32>; 
                ${decodedMaterial.hasSpecularTexture ? `@group(1) @binding(${ResourcesBindingPoints.SPECULAR_TEXTURE}) var targetTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let colorFactor=vec4f(vec3f(factors[13]),1);
                    ${decodedMaterial.hasSpecularTexture ? 'var model=textureSample(targetTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasSpecularTexture ? 'model=model * colorFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasSpecularTexture ? 'model.a' : 'colorFactor.a'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasSpecularTexture ? `return vec4f(model.xyz,alpha);` : 'return vec4f(colorFactor.xyz,alpha);'}
                }
            `
    } else if (isSpecularGlossiness) {

        shaderCode = `
                struct vsIn{
                    @location(0) pos:vec3f,
                    ${hasUv ? '@location(1) uv:vec2f' : ''}
                }
                struct vsOut{
                    @builtin(position) clipPos:vec4f,
                    ${hasUv ? '@location(0) uv:vec2f' : ''}
                }
                @group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
                @group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
                @group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;
                @vertex fn vs(in:vsIn)->vsOut{
                    var output:vsOut;
                    var worldPos = modelMatrix * vec4f(in.pos, 1);
                    output.clipPos = projectionMatrix * viewMatrix * worldPos;
                    ${hasUv ? 'output.uv=in.uv;' : ''}
                    return output;
                }
                
                @group(1) @binding(${ResourcesBindingPoints.FACTORS}) var<storage,read> factors:array<f32>; 
                ${decodedMaterial.hasGlossinessSpecularTexture ? `@group(1) @binding(${ResourcesBindingPoints.GLOSSINESS_SPECULAR_TEXTURE}) var targetTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let colorFactor=vec4f(vec3f(factors[16],factors[17],factors[18]),1);
                    ${decodedMaterial.hasGlossinessSpecularTexture ? 'var model=textureSample(targetTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasGlossinessSpecularTexture ? 'model=model * colorFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasGlossinessSpecularTexture ? 'model.a' : 'colorFactor.a'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasGlossinessSpecularTexture ? `return vec4f(model.xyz,alpha);` : 'return vec4f(colorFactor.xyz,alpha);'}
                }
            `
    } else if (isSpecularColor) {

        shaderCode = `
                struct vsIn{
                    @location(0) pos:vec3f,
                    ${hasUv ? '@location(1) uv:vec2f' : ''}
                }
                struct vsOut{
                    @builtin(position) clipPos:vec4f,
                    ${hasUv ? '@location(0) uv:vec2f' : ''}
                }
                @group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
                @group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
                @group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;
                @vertex fn vs(in:vsIn)->vsOut{
                    var output:vsOut;
                    var worldPos = modelMatrix * vec4f(in.pos, 1);
                    output.clipPos = projectionMatrix * viewMatrix * worldPos;
                    ${hasUv ? 'output.uv=in.uv;' : ''}
                    return output;
                }
                
                @group(1) @binding(${ResourcesBindingPoints.FACTORS}) var<storage,read> factors:array<f32>; 
                ${decodedMaterial.hasSpecularColorTexture ? `@group(1) @binding(${ResourcesBindingPoints.SPECULAR_COLOR_TEXTURE}) var targetTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let colorFactor=vec4f(vec3f(factors[19],factors[20],factors[21]),1);
                    ${decodedMaterial.hasSpecularColorTexture ? 'var model=textureSample(targetTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasSpecularColorTexture ? 'model=model * colorFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasSpecularColorTexture ? 'model.a' : 'colorFactor.a'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasSpecularColorTexture ? `return vec4f(model.xyz,alpha);` : 'return vec4f(colorFactor.xyz,alpha);'}
                }
            `

    }

    return shaderCode
}