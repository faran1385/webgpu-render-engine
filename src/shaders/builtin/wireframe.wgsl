

struct vsInput{
    @builtin(vertex_index) index:u32,

}

struct vsOutput{
    @builtin(position) clipPos:vec4f,
    @location(0) bary:vec3f
}

@group(0) @binding(0) var<uniform> projectionMatrix:mat4x4<f32>;
@group(0) @binding(1) var<uniform> viewMatrix:mat4x4<f32>;
@group(1) @binding(0) var<uniform> modelMatrix:mat4x4<f32>;

struct LineUniform{
    color:vec3f,
    thickness:f32,
    alphaThreshold:f32,
    pad:f32,
    pad2:f32,
}

@group(1) @binding(2) var<storage,read> positions:array<f32>;
@group(1) @binding(3) var<storage,read> indices:array<u32>;
@group(1) @binding(4) var<uniform> lineUniform:LineUniform;

@vertex fn vs(in: vsInput) -> vsOutput {
  let vertNdx = in.index % 3u;
  let i      = indices[in.index];
  let base   = i * 3u;
  let pos    = vec4f(positions[base + 0],
                     positions[base + 1],
                     positions[base + 2],
                     1.0);
  var out: vsOutput;
  let world  = modelMatrix * pos;
  out.clipPos = projectionMatrix * viewMatrix * world;

  out.bary = vec3f(0.0);
  out.bary[vertNdx] = 1.0;
  return out;
}




struct fsOutput{
    @location(0) context:vec4f,
}


@fragment fn fs(in: vsOutput) -> @location(0) vec4f {
    let d  = fwidth(in.bary);

    let a3 = smoothstep(vec3f(0.0), d * lineUniform.thickness, in.bary);
    let edge = min(min(a3.x, a3.y), a3.z);

    let a = 1.0 - edge;
    if (a < lineUniform.alphaThreshold) {
        discard;
    }

    return vec4f(vec3f(lineUniform.color), a);
}
