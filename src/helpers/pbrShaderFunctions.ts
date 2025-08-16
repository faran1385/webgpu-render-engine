export const distributionGGX = /* wgsl */ `
fn distributionGGX(N:vec3f,H:vec3f, r: f32) -> f32 {
    let a=r*r;
    let a2=a*a;
    let NoH  = max(dot(N, H), 0.0);
    let NoH2=NoH*NoH;
    var denominator=NoH2 * (a2 - 1) + 1;
    denominator = PI * (denominator * denominator);
    return a2 / denominator;
}
`;


export const radicalInverseVdC = /* wgsl */ `
// http://holger.dammertz.org/stuff/notes_HammersleyOnHemisphere.html
// efficient VanDerCorpus calculation.
fn radicalInverseVdC(bits: u32) -> f32 {
  var result = bits;
  result = (bits << 16u) | (bits >> 16u);
  result = ((result & 0x55555555u) << 1u) | ((result & 0xAAAAAAAAu) >> 1u);
  result = ((result & 0x33333333u) << 2u) | ((result & 0xCCCCCCCCu) >> 2u);
  result = ((result & 0x0F0F0F0Fu) << 4u) | ((result & 0xF0F0F0F0u) >> 4u);
  result = ((result & 0x00FF00FFu) << 8u) | ((result & 0xFF00FF00u) >> 8u);
  return f32(result) * 2.3283064365386963e-10;
}
`;

export const hammersley = /* wgsl */ `
fn hammersley(i: u32, n: u32) -> vec2f {
  return vec2f(f32(i) / f32(n), radicalInverseVdC(i));
}
`;

export const importanceSampleGGX = /* wgsl */ `
fn importanceSampleGGX(xi: vec2f, n: vec3f, roughness: f32) -> vec3f {
  let a = roughness * roughness;

  let phi = 2.0 * PI * xi.x;
  let cosTheta = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
  let sinTheta = sqrt(1.0 - cosTheta * cosTheta);

  // from spherical coordinates to cartesian coordinates - halfway vector
  let h = vec3f(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);

  // from tangent-space H vector to world-space sample vector
  let up: vec3f = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(n.z) < 0.999);
  let tangent = normalize(cross(up, n));
  let bitangent = cross(n, tangent);

  let sampleVec = tangent * h.x + bitangent * h.y + n * h.z;
  return normalize(sampleVec);
}
`;

export const toneMappings = {
    reinhard: /* wgsl */ `
  fn toneMapping(color: vec3f) -> vec3f {
    return color / (color + vec3f(1.0));
  }
  `,
    uncharted2: /* wgsl */ `
  fn uncharted2Helper(x: vec3f) -> vec3f {
    let a = 0.15;
    let b = 0.50;
    let c = 0.10;
    let d = 0.20;
    let e = 0.02;
    let f = 0.30;

    return (x * (a * x + c * b) + d * e) / (x * (a * x + b) + d * f) - e / f;
  }

  fn toneMapping(color: vec3f) -> vec3f {
    let w = 11.2;
    let exposureBias = 2.0;
    let current = uncharted2Helper(exposureBias * color);
    let whiteScale = 1 / uncharted2Helper(vec3f(w));
    return current * whiteScale;
  }
  `,
    aces: /* wgsl */ `
  fn toneMapping(color: vec3f) -> vec3f {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;

    return (color * (a * color + b)) / (color * (c * color + d) + e);
  }
  `,
    lottes: /* wgsl */ `
  fn toneMapping(color: vec3f) -> vec3f {
    let a = vec3f(1.6);
    let d = vec3f(0.977);
    let hdrMax = vec3f(8.0);
    let midIn = vec3f(0.18);
    let midOut = vec3f(0.267);

    let b = (-pow(midIn, a) + pow(hdrMax, a) * midOut) / ((pow(hdrMax, a * d) - pow(midIn, a * d)) * midOut);
    let c = (pow(hdrMax, a * d) * pow(midIn, a) - pow(hdrMax, a) * pow(midIn, a * d) * midOut) / ((pow(hdrMax, a * d) - pow(midIn, a * d)) * midOut);

    return pow(color, a) / (pow(color, a * d) * b + c);
  }
  `,
};






export const pbrFragmentHelpers = (overrides: Record<string, any>) => {
    return `
    `
}

export const pbrVertexHelpers = (overrides: Record<string, any>) => {
    return `
struct skinOutput {
    skinPos: vec4f,
    skinNormal: vec3f,
    skinTangent: vec4f,
}

${overrides.HAS_SKIN ? `
fn skinMat(in: vsIn) -> skinOutput {
    var skinnedPos = vec4f(0.0);
    var skinnedNormal = vec3f(0.0);
    var skinnedTangent = vec4f(0.0);

    for (var i = 0; i < 4; i = i + 1) {
        let jointIndex = in.joints[i];  
        let weight = in.weights[i];

        if (weight > 0.0001) {
            let boneMatrix = boneMatrices[jointIndex]; 

            skinnedPos += (boneMatrix * vec4f(in.pos, 1.0)) * weight;
            
            let boneMatrix3 =mat3x3<f32>(
                boneMatrix[0].xyz,
                boneMatrix[1].xyz,
                boneMatrix[2].xyz
            );
            
            ${overrides.HAS_NORMAL_VEC3 ? `
            skinnedNormal += (boneMatrix3 * in.normal) * weight;
            `:``}
            
            ${overrides.HAS_TANGENT_VEC4 ? `
            skinnedTangent += vec4f((boneMatrix3 * in.tangent.xyz) * weight,in.tangent.w * weight);
            `:``}
        }
    }

    return skinOutput(
        skinnedPos,
        skinnedNormal,
        skinnedTangent
    );
}
`:``}

fn getInfo(in: vsIn) -> Info {
    var output: Info;

    ${overrides.HAS_SKIN ? `
        let skinData = skinMat(in);
        output.worldPos = modelMatrix * skinData.skinPos;
    `:`
        output.worldPos = modelMatrix * vec4f(in.pos, 1.0);
    `}
    var T=vec3f(0);
    var B=vec3f(0);
    var N=vec3f(0);
    
    ${overrides.HAS_NORMAL_VEC3 ? `let normalMatrix =mat3x3<f32>(
        normalMatrix4[0].xyz,
        normalMatrix4[1].xyz,
        normalMatrix4[2].xyz
    );` : ""}
    
    ${overrides.HAS_TANGENT_VEC4 ? `
        ${overrides.HAS_SKIN?`
        N = skinData.skinNormal;
        var tangentDir = skinData.skinTangent.xyz;
        T = normalize(tangentDir - N * dot(N, tangentDir));
        
        B = cross(N, T) * skinData.skinTangent.w;
        B = normalize(B);
        
        output.N = N;
        output.T = T;
        output.B = B;
        `:`
        T = normalize(normalMatrix * in.tangent.xyz);
        N = normalize(normalMatrix * in.normal.xyz);
        T = normalize(T - N * dot(N, T));
        
        B = cross(N, T) * in.tangent.w;
        B = normalize(B);
        
        output.N = N;
        output.T = T;
        output.B = B;
        `}
    `:``}


    return output;
}
    `
}


export const ggxPrefilterCode={
    vertex:`
        struct VSOut {
          @builtin(position) Position: vec4f,
          @location(0) worldPosition: vec3f,
        };
        
        struct Uniforms {
          modelViewProjectionMatrix: mat4x4f,
          roughness: f32,
        };

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        
        @vertex
        fn main(@location(0) position: vec3f) -> VSOut {
          var output: VSOut;
          let worldPosition: vec4f=vec4f(position,1.);
          output.Position = uniforms.modelViewProjectionMatrix * worldPosition;
          output.worldPosition = worldPosition.xyz;
          return output;
        }
        `,
    fragment:`
        struct Uniforms {
          modelViewProjectionMatrix: mat4x4f,
          roughness: f32,
        };
        
        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
        @group(0) @binding(1) var environmentMap: texture_cube<f32>;
        @group(0) @binding(2) var environmentSampler: sampler;
        
        const PI = 3.14159265359;
        
        ${distributionGGX}
        ${radicalInverseVdC}
        ${hammersley}
        ${importanceSampleGGX}
        override SAMPLE_COUNT= 1024u;
        override TEXTURE_RESOLUTION= 1024f;
        
        @fragment
        fn main(@location(0) worldPosition: vec3f) -> @location(0) vec4f {
          var n = normalize(vec3f(worldPosition.x,-worldPosition.y,worldPosition.z));

          // Make the simplifying assumption that V equals R equals the normal
          let r = n;
          let v = r;
        
          var prefilteredColor = vec3f(0.0, 0.0, 0.0);
          var totalWeight = 0.0;
        
          for (var i: u32 = 0u; i < SAMPLE_COUNT; i = i + 1u) {
            // Generates a sample vector that's biased towards the preferred alignment
            // direction (importance sampling).
            let xi = hammersley(i, SAMPLE_COUNT);
            let h = importanceSampleGGX(xi, n, uniforms.roughness);
            let l = normalize(2.0 * dot(v, h) * h - v);
        
            let nDotL = clamp(dot(n, l), 0.0,1.);
        
            if(nDotL > 0.0) {
              // sample from the environment's mip level based on roughness/pdf
              let d = distributionGGX(n, h, uniforms.roughness);
              let nDotH = max(dot(n, h), 0.0);
              let hDotV = max(dot(h, v), 0.0);
              let pdf = d * nDotH / (4.0 * hDotV) + 0.0001;
        
              let saTexel = 4.0 * PI / (6.0 * TEXTURE_RESOLUTION * TEXTURE_RESOLUTION);
              let saSample = 1.0 / (f32(SAMPLE_COUNT) * pdf + 0.0001);
        
              let mipLevel = select(max(0.5 * log2(saSample / saTexel) + 1.0, 0.0), 0.0, uniforms.roughness == 0.0);
        
              prefilteredColor += textureSampleLevel(environmentMap, environmentSampler, l, mipLevel).rgb * nDotL;
              totalWeight += nDotL;
            }
          }
        
          prefilteredColor = prefilteredColor / totalWeight;
          return vec4f(prefilteredColor, 1.0);
        }
        `
}

export const charliePrefilterCode={
    vertex:            `// vertex.wgsl
        struct Uniforms {
          modelViewProjectionMatrix: mat4x4f,
          roughness: f32,
        };

        @group(0) @binding(0) var<uniform> uniforms: Uniforms;
                
        struct VSOut {
          @builtin(position) Position : vec4<f32>,
          @location(0) localPos : vec3<f32>,
        };
        
        @vertex
        fn main(@location(0) position : vec3<f32>) -> VSOut {
          var out : VSOut;
          out.Position = uniforms.modelViewProjectionMatrix * vec4<f32>(position, 1.0);
          out.localPos = position;
          return out;
        }`,
    fragment:            `
            // fragment.wgsl

override SAMPLE_COUNT: i32;
override TEXTURE_RESOLUTION: i32;

struct Uniforms {
    modelViewProjectionMatrix: mat4x4f,
    roughness: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var envCube : texture_cube<f32>;
@group(0) @binding(2) var envSmp : sampler;

// helpers
const PI: f32 = 3.141592653589793;

fn saturate(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn roughnessToAlpha(roughness: f32) -> f32 { return max(0.001, roughness * roughness); }

// Charlie NDF D(alpha, cosThetaH)
fn D_Charlie(alpha: f32, cosThetaH: f32) -> f32 {
    let c = saturate(cosThetaH);
    let sinThetaH = sqrt(max(0.0, 1.0 - c * c));
    let exponent = 1.0 / alpha;
    let sinPow = select(0.0, pow(sinThetaH, exponent), sinThetaH > 0.0);
    let norm = (2.0 + 1.0 / alpha) / (2.0 * PI);
    return norm * sinPow;
}

// cosine-weighted hemisphere sampling (tangent-space N=(0,0,1))
fn sampleCosineHemisphere(xi: vec2<f32>) -> vec3<f32> {
    let r = sqrt(max(0.0, xi.x));
    let phi = 2.0 * PI * xi.y;
    let x = r * cos(phi);
    let y = r * sin(phi);
    let z = sqrt(max(0.0, 1.0 - x*x - y*y));
    return vec3<f32>(x, y, z);
}

// simple wang_hash RNG
fn wang_hash(sIn: u32) -> u32 {
    var s=sIn;
    s = (s ^ 61u) ^ (s >> 16);
    s = s * 9u;
    s = s ^ (s >> 4);
    s = s * 0x27d4eb2du;
    s = s ^ (s >> 15);
    return s;
}

// main fragment
struct FSIn {
  @location(0) localPos : vec3<f32>,
  @builtin(position) fragCoord : vec4<f32>,
};

@fragment
fn main(in: FSIn) -> @location(0) vec4<f32> {
    // read roughness from uniform buffer: ubo[16] is the first float after the 4x4 matrix
    let roughness = uniforms.roughness;
    let envIntensity = 1.0; // if you want, you can pack envIntensity into ubo[17]

    // direction R: normalize local position (cube pos -> direction)
    let R = normalize(in.localPos);
    let N = R;
    let alpha = roughnessToAlpha(roughness);

    // tangent frame
    var up = vec3<f32>(0.0, 1.0, 0.0);
    if (abs(N.y) > 0.999) {
        up = vec3<f32>(1.0, 0.0, 0.0);
    }
    let tangent = normalize(cross(up, N));
    let bitangent = cross(N, tangent);
    let T = mat3x3<f32>(tangent, bitangent, N); // columns tangent, bitangent, N

    var prefiltered : vec3<f32> = vec3<f32>(0.0);
    var totalWeight : f32 = 0.0;

    // seed from pixel coordinates + small roughness influence
    let fx = u32(floor(in.fragCoord.x));
    let fy = u32(floor(in.fragCoord.y));
    var seed = fx * 1973u + fy * 9277u + u32(max(1.0, roughness * 1000.0));

    // Monte Carlo loop
    var i: i32 = 0;
    let count: i32 = SAMPLE_COUNT;
    loop {
        if (i >= count) { break; }
        seed = wang_hash(seed);
        let r1 = f32(seed) / 4294967296.0;
        seed = wang_hash(seed);
        let r2 = f32(seed) / 4294967296.0;
        let xi = vec2<f32>(r1, r2);

        let sampleT = sampleCosineHemisphere(xi);
        let L = normalize(T * sampleT);

        let NdotL = max(dot(N, L), 0.0);
        if (NdotL > 0.0) {
            let V = R;
            let H = normalize(L + V);
            let NdotH = max(dot(N, H), 0.0);
            let D = D_Charlie(alpha, NdotH);

            let pdf_cos = sampleT.z / PI; // cosine hemisphere pdf
            let weight = select(0.0, (D * NdotL) / pdf_cos, pdf_cos > 0.0);

            // sample environment at this incoming direction
            let envCol = textureSampleLevel(envCube, envSmp, L, 0.0).rgb;

            prefiltered = prefiltered + envCol * weight;
            totalWeight = totalWeight + weight;
        }

        i = i + 1;
    }

    if (totalWeight > 0.0) {
        prefiltered = prefiltered / totalWeight;
    }

    prefiltered = prefiltered * envIntensity;

    return vec4<f32>(prefiltered, 1.0);
}
        `
}


export const ggxBRDFLUTCode={
    vertex: `
            struct VertexOutput {
              @builtin(position) Position: vec4f,
              @location(0) uv: vec2f,
            }
            
            @vertex
            fn main(@location(0) position: vec2f, @location(1) uv: vec2f) -> VertexOutput {
              var output: VertexOutput;
              output.Position = vec4f(position,0., 1.0);
              output.uv = uv;
              return output;
            }
        `,
    fragment:`
            const PI: f32 = 3.14159265359;
            
            ${radicalInverseVdC}
            ${hammersley}
            ${importanceSampleGGX}
            
            // This one is different
            fn G_SchlicksmithGGX(dotNL:f32, dotNV:f32, roughness:f32)->f32{
                let k = (roughness * roughness) / 2.0;
                let GL = dotNL / (dotNL * (1.0 - k) + k);
                let GV = dotNV / (dotNV * (1.0 - k) + k);
                return GL * GV;
            }
            
            fn integrateBRDF(NdotV: f32, roughness: f32) -> vec2f {
              var V: vec3f;
              V.x = sqrt(1.0 - NdotV * NdotV);
              V.y = 0.0;
              V.z = NdotV;
            
              var A: f32 = 0.0;
              var B: f32 = 0.0;
            
              let N = vec3f(0.0, 0.0, 1.0);
            
              let SAMPLE_COUNT: u32 = 1024u;
              for(var i: u32 = 0u; i < SAMPLE_COUNT; i = i + 1u) {
                  let Xi: vec2f = hammersley(i, SAMPLE_COUNT);
                  let H: vec3f = importanceSampleGGX(Xi, N, roughness);
                  let L: vec3f = normalize(2.0 * dot(V, H) * H - V);
            
                  let dotNL = max(dot(N, L), 0.0);
                  let dotNV = max(dot(N, V), 0.0);
                  let dotVH = max(dot(V, H), 0.0); 
                  let dotNH = max(dot(H, N), 0.0);
            
                  if(dotNL > 0.0) {
                      let G = G_SchlicksmithGGX(dotNL, dotNV, roughness);
                      let G_Vis = (G * dotVH) / (dotNH * dotNV);
                      let Fc = pow(1.0 - dotVH, 5.0);
            
                      A += (1.0 - Fc) * G_Vis;
                      B += Fc * G_Vis;
                  }
              }
              A /= f32(SAMPLE_COUNT);
              B /= f32(SAMPLE_COUNT);
              return vec2f(A, B);
            }
            
            @fragment
            fn main(@location(0) uv: vec2f) -> @location(0) vec2f {
              let result = integrateBRDF(uv.x, 1 - uv.y);
              return result;
            }
            `
}








