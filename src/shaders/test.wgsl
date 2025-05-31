struct vsInput{
    @location(0) pos:vec3f,
}

struct vsOutput{
    @builtin(position) clipPos:vec4f,
}

@group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
@group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
@group(1) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;

@vertex fn vs(in: vsInput) -> vsOutput {
    var output: vsOutput;

    var worldPos = modelMatrix * vec4f(in.pos, 1);

    output.clipPos = projectionMatrix * viewMatrix * worldPos;

    return output;
}



struct fsOutput{
    @location(0) context:vec4f,
}


@fragment
fn fs(in:vsOutput) -> fsOutput {
    var output:fsOutput;

    output.context=vec4f(0,0,0,1);
    return output;
}
