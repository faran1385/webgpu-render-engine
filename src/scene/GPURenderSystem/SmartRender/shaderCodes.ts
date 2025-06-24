export const vertexShaderCodes: Map<"withBone" | "withUv" | "withUvAndBone" | "withoutUvAndBone", string> = new Map([
    ["withBone", `struct vsIn{
    @location(0) pos:vec3f,
    @location(3) joints:vec4u,
    @location(4) weights:vec4f,
    }
struct vsOut{
    @builtin(position) clipPos:vec4f,
    @location(0) uv:vec2f
}
@group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
@group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
@group(2) @binding(1) var<storage,read> jointsMatrices:array<mat4x4<f32>>;
@vertex fn vs(in:vsIn)->vsOut{
    var output:vsOut;
    let joint0 = jointsMatrices[in.joints.x];
    let joint1 = jointsMatrices[in.joints.y];
    let joint2 = jointsMatrices[in.joints.z];
    let joint3 = jointsMatrices[in.joints.w];

    let pos = vec4f(in.pos, 1.0);

    let skinned =
        (joint0 * pos) * in.weights.x +
        (joint1 * pos) * in.weights.y +
        (joint2 * pos) * in.weights.z +
        (joint3 * pos) * in.weights.w;

    output.clipPos = projectionMatrix * viewMatrix * skinned;
    return output;
}`],
        ["withoutUvAndBone", `struct vsIn{
    @location(0) pos:vec3f,
}
struct vsOut{
    @builtin(position) clipPos:vec4f,
}
@group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
@group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
@group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;
@group(2) @binding(1) var<storage,read> jointsMatrices:array<mat4x4<f32>>;

@vertex fn vs(in:vsIn)->vsOut{
    var output:vsOut;
    var worldPos = modelMatrix * vec4f(in.pos, 1);
    output.clipPos = projectionMatrix * viewMatrix * worldPos;
    return output;
}`],
    ["withUv", `
struct vsIn{
    @location(0) pos:vec3f,
    @location(1) uv:vec2f,
}
struct vsOut{
    @builtin(position) clipPos:vec4f,
    @location(0) uv:vec2f,
}
@group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
@group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
@group(2) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;
@vertex fn vs(in:vsIn)->vsOut{
    var output:vsOut;
    var worldPos = modelMatrix * vec4f(in.pos, 1);
    output.clipPos = projectionMatrix * viewMatrix * worldPos;
    output.uv = in.uv;
    return output;
}`],
            ["withUvAndBone", `
struct vsIn {
    @location(0) pos: vec3f,
    @location(1) uv: vec2f,
    @location(3) joints: vec4<u32>,
    @location(4) weights: vec4f,
};

struct vsOut {
    @builtin(position) clipPos: vec4f,
    @location(0) uv: vec2f,
};

@group(0) @binding(0) var<uniform> projectionMatrix: mat4x4<f32>;
@group(0) @binding(1) var<uniform> viewMatrix: mat4x4<f32>;

@group(2) @binding(1) var<storage, read> jointsMatrices: array<mat4x4<f32>>;

@vertex
fn vs(in: vsIn) -> vsOut {
    var output: vsOut;

    let joint0 = jointsMatrices[in.joints.x];
    let joint1 = jointsMatrices[in.joints.y];
    let joint2 = jointsMatrices[in.joints.z];
    let joint3 = jointsMatrices[in.joints.w];

    let pos = vec4f(in.pos, 1.0);

    let skinned =
        (joint0 * pos) * in.weights.x +
        (joint1 * pos) * in.weights.y +
        (joint2 * pos) * in.weights.z +
        (joint3 * pos) * in.weights.w;

    output.clipPos = projectionMatrix * viewMatrix * skinned;
    output.uv = in.uv;
    return output;
}
`]
])

export const baseColorFragment = [
    `@group(1) @binding(0) var<uniform> factors:vec4f; 
@group(1) @binding(1) var baseColorTexture : texture_2d<f32>;
@group(1) @binding(2) var textureSampler:sampler;
@group(1) @binding(3) var<uniform> alphaMode:vec2f;

@fragment fn fs(in:vsOut)->@location(0) vec4f {
    var model = textureSample(baseColorTexture, textureSampler, in.uv);
    model = model * factors;
    let alphaValue = model.a;

    if (i32(alphaMode.r) == 2 && alphaValue < alphaMode.g) {
        discard;
    }
    let alpha = select(1.0, alphaValue, u32(alphaMode.r) == 1u);
    return vec4f(model.xyz, alpha);
}`,
    `@group(1) @binding(0) var<uniform> factors:vec4f; 
@group(1) @binding(1) var<uniform> alphaMode:vec2f;

@fragment fn fs(in:vsOut)->@location(0) vec4f {
    let alphaValue = factors.a;

    if (i32(alphaMode.r) == 2 && alphaValue < alphaMode.y) {
        discard;
    }
    let alpha = select(1.0, alphaValue, u32(alphaMode.r) == 1u);
    return vec4f(factors.xyz, alpha);
}`
];


export const emissiveFragments = [
    `@group(1) @binding(0) var<uniform> factors: vec4f;
@group(1) @binding(1) var emissiveTexture: texture_2d<f32>;
@group(1) @binding(2) var textureSampler: sampler;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    let emissiveRGB = factors.xyz * factors.w;
    let emissiveFactor = vec4f(emissiveRGB, 1.0);
    var model = textureSample(emissiveTexture, textureSampler, in.uv);

    return vec4f(model.xyz, 1.);
}`,
        `@group(1) @binding(0) var<uniform> factors: vec4f;
@group(1) @binding(1) var<uniform> alphaMode: vec2f;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    let emissiveRGB = factors.xyz * factors.w;
    let emissiveFactor = vec4f(emissiveRGB, 1.0);

    return emissiveFactor;
}`
]


export const opacityFragments = [
    `@group(1) @binding(0) var<uniform> factors: vec4f; 
@group(1) @binding(1) var baseColorTexture: texture_2d<f32>;
@group(1) @binding(2) var textureSampler: sampler;
@group(1) @binding(3) var<uniform> alphaMode: vec2f; 

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    let colorFactor = factors;
    var model = textureSample(baseColorTexture, textureSampler, in.uv);
    model = model * colorFactor;

    let alphaValue = model.a;
    let alphaCutOff = alphaMode.y;

    if (i32(alphaMode.x) == 2 && alphaValue < alphaCutOff) {
        discard;
    }

    let alpha = select(1.0, alphaValue, u32(alphaMode.x) == 1u);
    return vec4f(vec3f(alpha), 1.0);
}`,

    `@group(1) @binding(0) var<uniform> factors: vec4f;
@group(1) @binding(1) var<uniform> alphaMode: vec2f;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    let colorFactor = factors;
    let alphaValue = colorFactor.a;
    let alphaCutOff = alphaMode.y;

    if (i32(alphaMode.x) == 2 && alphaValue < alphaCutOff) {
        discard;
    }

    let alpha = select(1.0, alphaValue, u32(alphaMode.x) == 1u);
    return vec4f(vec3f(alpha), 1.0);
}`
]


export const occlusionFragments = [
    `@group(1) @binding(0) var<uniform> strength: f32;
@group(1) @binding(1) var occlusionTexture: texture_2d<f32>;
@group(1) @binding(2) var textureSampler: sampler;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    var model = textureSample(occlusionTexture, textureSampler, in.uv);
    model = model * strength;
    
    return vec4f(vec3f(model.r), 1.);
}`,

    `@group(1) @binding(0) var<uniform> strength: f32;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    return vec4f(vec3f(strength), 1.);
}`
]


export const normalFragments = [
    `@group(1) @binding(0) var<uniform> scale: f32;
@group(1) @binding(1) var normalTexture: texture_2d<f32>;
@group(1) @binding(2) var textureSampler: sampler;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    var model = textureSample(normalTexture, textureSampler, in.uv);
    model = model * scale;
    
    return vec4f(model.xyz, 1.);
}`,

    `@group(1) @binding(0) var<uniform> scale: f32;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    return vec4f(vec3f(scale), 1.);
}`
]

export const metallicFragments = [
    `@group(1) @binding(0) var<uniform> metallicFactor: f32;
@group(1) @binding(1) var metallicRoughnessTexture: texture_2d<f32>;
@group(1) @binding(2) var textureSampler: sampler;
@group(1) @binding(3) var<uniform> alphaMode: vec2f;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    var model = textureSample(metallicRoughnessTexture, textureSampler, in.uv);
    model = model * metallicFactor;

    return vec4f(vec3f(model.b), 1);
}`,

    `@group(1) @binding(0) var<uniform> metallicFactor: f32;
@group(1) @binding(1) var<uniform> alphaMode: vec2f;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    return vec4f(vec3f(metallicFactor), 1);
}`
]


export const roughnessFragments = [
    `@group(1) @binding(0) var<uniform> roughnessFactor: f32;
@group(1) @binding(1) var metallicRoughnessTexture: texture_2d<f32>;
@group(1) @binding(2) var textureSampler: sampler;
@group(1) @binding(3) var<uniform> alphaMode: vec2f;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    var model = textureSample(metallicRoughnessTexture, textureSampler, in.uv);
    model = model * roughnessFactor;

    return vec4f(vec3f(model.g), 1);
}`,

    `@group(1) @binding(0) var<uniform> roughnessFactor: f32;
@group(1) @binding(1) var<uniform> alphaMode: vec2f;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    return vec4f(vec3f(roughnessFactor), 1);
}`
]


export const transmissionFragments = [
    `@group(1) @binding(0) var<uniform> transmissionFactor: f32;
@group(1) @binding(1) var transmissionTexture: texture_2d<f32>;
@group(1) @binding(2) var textureSampler: sampler;
@group(1) @binding(3) var<uniform> alphaMode: f32;
@group(1) @binding(4) var<uniform> alphaCutOff: f32;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    var model = textureSample(transmissionTexture, textureSampler, in.uv);
    model = model * transmissionFactor;
    return vec4f(vec3f(model.r), 1);
}`,

    `@group(1) @binding(0) var<uniform> transmissionFactor: f32;
@group(1) @binding(1) var<uniform> alphaMode: vec2f;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    return vec4f(vec3f(transmissionFactor), 1.);
}`
]


export const specularFragments = [
    `@group(1) @binding(0) var<uniform> specularFactor: f32;
@group(1) @binding(1) var specularTexture: texture_2d<f32>;
@group(1) @binding(2) var textureSampler: sampler;
@group(1) @binding(3) var<uniform> alphaMode: vec2f;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    var model = textureSample(specularTexture, textureSampler, in.uv);
    model *= specularFactor;

    return vec4f(vec3f(model.xyz), 1);
}`,

    `@group(1) @binding(0) var<uniform> specularFactor: f32;
@group(1) @binding(1) var<uniform> alphaMode: vec2f;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    return vec4f(vec3f(specularFactor), 1);
}`
]


export const clearcoatFragments = [
    `@group(1) @binding(0) var<uniform> clearcoatFactor: f32;
@group(1) @binding(1) var clearcoatTexture: texture_2d<f32>;
@group(1) @binding(2) var textureSampler: sampler;
@group(1) @binding(3) var<uniform> alphaMode: vec2f;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    var model = textureSample(clearcoatTexture, textureSampler, in.uv);
    model = model * clearcoatFactor;
    return vec4f(vec3f(model.r), 1);
}`,

    `@group(1) @binding(0) var<uniform> clearcoatFactor: f32;

@fragment fn fs(in: vsOut) -> @location(0) vec4f {
    return vec4f(vec3f(clearcoatFactor), 1);
}`
]



