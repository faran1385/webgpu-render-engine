struct vsInput{
    @location(0) pos:vec4f,
    @location(1) uv:vec2f
}

struct vsOutput{
    @builtin(position) clipPos:vec4f,
    @location(0) uv:vec2f,
    @location(1) pos:vec3f
}

@group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
@group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
@group(0) @binding(2) var<uniform> t:f32;
@group(1) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;
@group(1) @binding(1) var<uniform> normalMatrix:mat3x4<f32>;


@vertex fn vs(in: vsInput) -> vsOutput {
    var output: vsOutput;

    var worldPos = modelMatrix * in.pos;


    output.clipPos =projectionMatrix * viewMatrix * worldPos;
    output.uv=in.uv;
    output.pos=in.pos.xyz;
    return output;
}

fn reinhardToneMapping(color: vec3<f32>) -> vec3<f32> {
    return color / (color + vec3<f32>(1.0));
}
struct fsOutput{
    @location(0) context:vec4f,
}

@group(1) @binding(2) var cubeTexture:texture_cube<f32>;
@group(1) @binding(3) var cubeSampler:sampler;

@fragment
fn fs(in:vsOutput) -> fsOutput {
    let cubeTexture=textureSample(cubeTexture,cubeSampler,in.pos);
    let color=reinhardToneMapping(cubeTexture.xyz);
    var output: fsOutput;
    output.context=vec4f(vec3f(color),1);
    return output;
}
