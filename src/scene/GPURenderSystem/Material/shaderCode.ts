import {DecodedMaterialFlags, ResourcesBindingPoints} from "../../loader/loaderTypes.ts";

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
    isClearcoat: boolean,
    isClearcoatRoughness: boolean,
    isClearcoatNormal: boolean,
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
        isRoughness,
        isClearcoatRoughness,
        isClearcoat,
        isClearcoatNormal
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
                ${decodedMaterial.hasBaseColorTexture ? `@group(1) @binding(${ResourcesBindingPoints.BASE_COLOR_TEXTURE}) var baseColorTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let colorFactor=vec4f(factors[0],factors[1],factors[2],factors[3]);
                    ${decodedMaterial.hasBaseColorTexture ? 'var model=textureSample(baseColorTexture,textureSampler,in.uv);' : ''}
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
                ${decodedMaterial.hasBaseColorTexture ? `@group(1) @binding(${ResourcesBindingPoints.BASE_COLOR_TEXTURE}) var baseColorTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let colorFactor=vec4f(factors[0],factors[1],factors[2],factors[3]);
                    ${decodedMaterial.hasBaseColorTexture ? 'var model=textureSample(baseColorTexture,textureSampler,in.uv);' : ''}
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
                ${decodedMaterial.hasOcclusionTexture ? `@group(1) @binding(${ResourcesBindingPoints.OCCLUSION_TEXTURE}) var occlusionTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let strength=factors[7];
                    ${decodedMaterial.hasOcclusionTexture ? 'var model=textureSample(occlusionTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasOcclusionTexture ? 'model=model * strength;' : ''}
                    let alphaValue=${decodedMaterial.hasOcclusionTexture ? 'model.a' : 'strength'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasOcclusionTexture ? 'return vec4f(vec3f(model.r),alpha);' : 'return vec4f(vec3f(strength),alpha);'}
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
                ${decodedMaterial.hasNormalTexture ? `@group(1) @binding(${ResourcesBindingPoints.NORMAL_TEXTURE}) var normalTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let scale=factors[8];
                    ${decodedMaterial.hasNormalTexture ? 'var model=textureSample(normalTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasNormalTexture ? 'model=model * scale;' : ''}
                    let alphaValue=${decodedMaterial.hasNormalTexture ? 'model.a' : 'scale'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasNormalTexture ? 'return vec4f(model.xyz,alpha);' : 'return vec4f(vec3f(scale),alpha);'}
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
                ${decodedMaterial.hasMetallicRoughnessTex ? `@group(1) @binding(${ResourcesBindingPoints.METALLIC_ROUGHNESS_TEXTURE}) var metallicRoughnessTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let factor=factors[${isMetallic ? 9 : 10}];
                    ${decodedMaterial.hasMetallicRoughnessTex ? 'var model=textureSample(metallicRoughnessTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasMetallicRoughnessTex ? 'model=model * factor;' : ''}
                    let alphaValue=${decodedMaterial.hasMetallicRoughnessTex ? 'model.a' : 'factor'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasMetallicRoughnessTex ? `return vec4f(vec3f(model.${isMetallic ? 'b' : 'g'}),alpha);` : 'return vec4f(vec3f(factor),alpha);'}
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
                ${decodedMaterial.hasTransmissionTexture ? `@group(1) @binding(${ResourcesBindingPoints.TRANSMISSION_TEXTURE}) var transmissionTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let transmissionFactor=factors[11];
                    ${decodedMaterial.hasTransmissionTexture ? 'var model=textureSample(transmissionTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasTransmissionTexture ? 'model=model * transmissionFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasTransmissionTexture ? 'model.a' : 'transmissionFactor'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasTransmissionTexture ? `return vec4f(vec3f(model.r),alpha);` : 'return vec4f(vec3f(transmissionFactor),alpha);'}
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
                ${decodedMaterial.hasGlossinessTexture ? `@group(1) @binding(${ResourcesBindingPoints.GLOSSINESS_TEXTURE}) var glossinessTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let glossinessFactor = factors[12];
                    ${decodedMaterial.hasGlossinessTexture ? 'var model=textureSample(glossinessTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasGlossinessTexture ? 'model=model * glossinessFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasGlossinessTexture ? 'model.a' : 'glossinessFactor'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasGlossinessTexture ? `return vec4f(vec3f(model.a),alpha);` : 'return vec4f(vec3f(glossinessFactor),alpha);'}
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
                ${decodedMaterial.hasSpecularTexture ? `@group(1) @binding(${ResourcesBindingPoints.SPECULAR_TEXTURE}) var specularTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let specularFactor=factors[13];
                    ${decodedMaterial.hasSpecularTexture ? 'var model=textureSample(specularTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasSpecularTexture ? 'model=model * specularFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasSpecularTexture ? 'model.a' : 'specularFactor'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasSpecularTexture ? `return vec4f(vec3f(model.a),alpha);` : 'return vec4f(vec3f(specularFactor),alpha);'}
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
                ${decodedMaterial.hasGlossinessSpecularTexture ? `@group(1) @binding(${ResourcesBindingPoints.GLOSSINESS_SPECULAR_TEXTURE}) var glossinessSpecularTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let specularFactor=vec4f(vec3f(factors[16],factors[17],factors[18]),1);
                    ${decodedMaterial.hasGlossinessSpecularTexture ? 'var model=textureSample(glossinessSpecularTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasGlossinessSpecularTexture ? 'model=model * specularFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasGlossinessSpecularTexture ? 'model.a' : 'specularFactor.a'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasGlossinessSpecularTexture ? `return vec4f(model.xyz,alpha);` : 'return vec4f(specularFactor.xyz,alpha);'}
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
                ${decodedMaterial.hasSpecularColorTexture ? `@group(1) @binding(${ResourcesBindingPoints.SPECULAR_FO_TEXTURE}) var specularFOTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let specularFOFactor=vec4f(vec3f(factors[19],factors[20],factors[21]),1);
                    ${decodedMaterial.hasSpecularColorTexture ? 'var model=textureSample(specularFOTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasSpecularColorTexture ? 'model=model * specularFOFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasSpecularColorTexture ? 'model.a' : 'specularFOFactor.a'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasSpecularColorTexture ? `return vec4f(model.xyz,alpha);` : 'return vec4f(specularFOFactor.xyz,alpha);'}
                }
            `

    } else if (isClearcoat) {

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
                ${decodedMaterial.hasClearcoatTexture ? `@group(1) @binding(${ResourcesBindingPoints.CLEARCOAT_TEXTURE}) var clearcoatTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let clearcoatFactor=factors[22];
                    ${decodedMaterial.hasClearcoatTexture ? 'var model=textureSample(clearcoatTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasClearcoatTexture ? 'model=model * clearcoatFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasClearcoatTexture ? 'model.a' : 'clearcoatFactor'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasClearcoatTexture ? `return vec4f(vec3f(model.r),alpha);` : 'return vec4f(vec3f(clearcoatFactor),alpha);'}
                }
            `

    }else if (isClearcoatNormal) {

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
                ${decodedMaterial.hasClearcoatNormalTexture ? `@group(1) @binding(${ResourcesBindingPoints.CLEARCOAT__NORMAL_TEXTURE}) var clearcoatNormalTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let clearcoatNormalScale=factors[24];
                    ${decodedMaterial.hasClearcoatNormalTexture ? 'var model=textureSample(clearcoatNormalTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasClearcoatNormalTexture ? 'model=model * clearcoatNormalScale;' : ''}
                    let alphaValue=${decodedMaterial.hasClearcoatNormalTexture ? 'model.a' : 'clearcoatNormalScale'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasClearcoatNormalTexture ? `return vec4f(model.xyz,alpha);` : 'return vec4f(vec3f(clearcoatNormalScale),alpha);'}
                }
            `

    }else if (isClearcoatRoughness) {

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
                ${decodedMaterial.hasClearcoatRoughnessTexture ? `@group(1) @binding(${ResourcesBindingPoints.CLEARCOAT_ROUGHNESS_TEXTURE}) var clearcoatRoughnessTexture : texture_2d<f32>;` : ''}
                ${decodedMaterial.hasSampler ? `@group(1) @binding(${ResourcesBindingPoints.SAMPLER}) var textureSampler:sampler;` : ''}
                @group(1) @binding(${ResourcesBindingPoints.ALPHA}) var<uniform> alphaMode:f32;
                
                @fragment fn fs(in:vsOut)->@location(0) vec4f{
                    let roughnessFactor=factors[23];
                    ${decodedMaterial.hasClearcoatRoughnessTexture ? 'var model=textureSample(clearcoatRoughnessTexture,textureSampler,in.uv);' : ''}
                    ${decodedMaterial.hasClearcoatRoughnessTexture ? 'model=model * roughnessFactor;' : ''}
                    let alphaValue=${decodedMaterial.hasClearcoatRoughnessTexture ? 'model.a' : 'roughnessFactor'};
                    let alphaCutOff=factors[15];
                    
                    if(i32(alphaMode) == 2 && alphaValue < alphaCutOff){
                        discard;
                    }
                    let alpha = select(1.0, alphaValue, u32(alphaMode) == 1u);
                    ${decodedMaterial.hasClearcoatRoughnessTexture ? `return vec4f(vec3f(model.g),alpha);` : 'return vec4f(vec3f(roughnessFactor),alpha);'}
                }
            `

    }

    return shaderCode
}