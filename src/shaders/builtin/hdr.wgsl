// hdrShader.wgsl

const PI = 3.141592653589793;

// ——— Bindings ———
// group(0) = sharedBindGroup (HDR texture + sampler)
@group(0) @binding(0) var hdrTex : texture_2d<f32>;
@group(0) @binding(1) var hdrSmp : sampler;


@group(1) @binding(0) var<uniform> faceMatrix: mat3x4<f32>;

// ——— Vertex I/O ———
struct VSIn {
  @location(0) pos : vec2<f32>, // [-1..1] quad
  @location(1) uv  : vec2<f32>, // [ 0..1] quad
};
struct VSOut {
  @builtin(position) Position : vec4<f32>,
  @location(0) faceUV         : vec2<f32>,
};

@vertex
fn vs(in: VSIn) -> VSOut {
  var out : VSOut;
  out.Position = vec4(in.pos, 0.0, 1.0);

  out.faceUV = in.uv * 2.0 - vec2(1.0);
  return out;
}

fn dirToEquirectUV(dir: vec3<f32>) -> vec2<f32> {
  let PI = 3.141592653589793;
  let u = 0.5 + atan2(dir.z, dir.x) / (2.0 * PI);
  let v = 0.5 - asin(dir.y) / PI;
  return vec2<f32>(u, v);
}


// ——— Fragment ———
@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
    let rayDir = normalize(
            faceMatrix[0].xyz * in.faceUV.x +
            faceMatrix[1].xyz * in.faceUV.y +
            faceMatrix[2].xyz
    );
    let eUV = dirToEquirectUV(rayDir);

    return textureSample(hdrTex, hdrSmp, eUV);
}
