import {GAMMA_CORRECTION} from "./postProcessUtils/postProcessUtilsShaderCodes.ts";

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
    
        fn setNormal(globalInfo:MaterialInfo,uv:vec2f,TBN:mat3x3f,normal:vec3f)->MaterialInfo{
            var info=globalInfo;
            
            info.normal=normal;
            
            ${overrides.HAS_NORMAL_MAP ? `
            let sampledTex=textureSample([[normal.texture]],[[normal.sampler]],uv,[[normal.textureIndex]]);
            var n = sampledTex.rgb * 2.0 - 1.0;
            n = vec3<f32>(n.xy * materialFactors.normalScale, n.z);
            info.normal = normalize(TBN * n);
            `:``}
                        
            return info;
        }    
        
        fn setClearcoat(globalInfo:MaterialInfo,uv:vec2f,TBN:mat3x3f,ior:f32)->MaterialInfo{
            var info=globalInfo;
            info.clearcoatF0=vec3f(dielectricIorToF0(ior));
            info.clearcoatWeight=max(materialFactors.clearcoat, 1e-4);
            info.clearcoatRoughness=max(materialFactors.clearcoatRoughness, 1e-4);;
            
            ${overrides.HAS_CLEARCOAT_MAP ? `
            let clearcoatSampledTex=textureSample([[clearcoat.texture]],[[clearcoat.sampler]],uv,[[clearcoat.textureIndex]]);
            info.clearcoatWeight *=clamp(clearcoatSampledTex.r, 0.0, 1.0);
            `:``}
            
            ${overrides.HAS_CLEARCOAT_ROUGHNESS_MAP ? `
            let clearcoatRoughnessSampledTex=textureSample([[clearcoat_roughness.texture]],[[clearcoat_roughness.sampler]],uv,[[clearcoat_roughness.textureIndex]]);
            info.clearcoatRoughness *=clamp(clearcoatRoughnessSampledTex.g, 1e-4, 1.0);
            `:``}            
            
            ${overrides.HAS_CLEARCOAT_NORMAL_MAP ? `
            let clearcoatNormalSampledTex=textureSample([[clearcoat_normal.texture]],[[clearcoat_normal.sampler]],uv,[[clearcoat_normal.textureIndex]]);
            var n = clearcoatNormalSampledTex.rgb * 2.0 - 1.0;
            n = vec3<f32>(n.xy * materialFactors.clearcoatNormalScale, n.z);
            info.clearcoatNormal = normalize(TBN * n);
            `:`
            info.clearcoatNormal=info.normal;
            `}
            
            info.clearcoatAlphaRoughness=info.clearcoatRoughness * info.clearcoatRoughness;
            
            return info;
        }
    
        fn setEmissive(globalInfo:MaterialInfo,uv:vec2f)->MaterialInfo{
            var info=globalInfo;
            
            info.emissive=materialFactors.emissive;
            
            ${overrides.HAS_EMISSIVE_MAP ? `
            let sampledTex=textureSample([[emissive.texture]],[[emissive.sampler]],uv,[[emissive.textureIndex]]);
            info.emissive =sampledTex.rgb;
            `:``}
            
            return info;
        }
        
        ${GAMMA_CORRECTION}
        
        fn getIBL(
        baseColor:vec3f,
        metallic:f32,
        n:vec3f,
        r:vec3f,
        NoV:f32,
        F:vec3f,
        roughness:f32,
        ao:f32
        )->vec3f{
            let irradiance = textureSample(irradianceMap,iblSampler, n).rgb;
            let diffuse    = irradiance * baseColor;
            
            let kS = F;
            var kD = 1.0 - kS;
            kD *= 1.0 - metallic;
            
            let prefilteredColor = textureSampleLevel(ggxPrefilterMap,iblSampler, r,  roughness * f32(ENV_MAX_LOD_COUNT)).rgb;   
            let envBRDF  = textureSample(ggxLUT,iblSampler, vec2f(NoV, roughness)).rg;
            let specular = prefilteredColor * (F * envBRDF.x + envBRDF.y);
            let ambient = (kD * diffuse + specular) * ao; 
            return ambient;
        }        
        

    
        fn setAO(globalInfo:MaterialInfo,uv:vec2f)->MaterialInfo{
            var info=globalInfo;
            info.ao=materialFactors.occlusionStrength;
            
            ${overrides.HAS_AO_MAP ? `
            let sampledTex=textureSample([[ambient_occlusion.texture]],[[ambient_occlusion.sampler]],uv,[[ambient_occlusion.textureIndex]]);
            info.ao *=sampledTex.r;
            `:``}
            
            return info;
        }
        
        fn setMetallicRoughness(globalInfo:MaterialInfo,uv:vec2f)->MaterialInfo{
            var info=globalInfo;
            
            info.metallic=materialFactors.metallic;
            info.perceptualRoughness=materialFactors.roughness;
            
            ${overrides.HAS_METALLIC_ROUGHNESS_MAP ? `
            let sampledTex=textureSample([[metallic_roughness.texture]],[[metallic_roughness.sampler]],uv,[[metallic_roughness.textureIndex]]);
            info.metallic *=sampledTex.b;
            info.perceptualRoughness *=sampledTex.g;
            `:``}
            info.alphaRoughness=info.perceptualRoughness * info.perceptualRoughness;
            
            return info;
        }
        fn FresnelSchlickRoughness(cosTheta:f32, F0:vec3f, roughness:f32)->vec3f{
            return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
        }   
        
        fn fresnelSchlick(cosTheta:f32, F0:vec3f)->vec3f{
            return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
        }        
        
        fn dielectricIorToF0(ior:f32)->f32{
            return pow((1 - ior) / (1 + ior),2);
        }
        
        // clamp helper
        fn saturate(x: f32) -> f32 {
          return clamp(x, 0.0, 1.0);
        }

        // GGX / Trowbridge-Reitz NDF
        fn D_GGX(nDotH: f32, a: f32) -> f32 {
          let a2: f32 = a * a; // alpha^2
          let nDotH2: f32 = nDotH * nDotH;
          let denom: f32 = nDotH2 * (a2 - 1.0) + 1.0;
          return a2 / (PI * denom * denom);
        }
        
        fn G_Schlick_GGX_G1(nDotV: f32, roughness: f32) -> f32 {
          let ndv: f32 = saturate(nDotV);
          let r: f32 = saturate(roughness);
          let k: f32 = (r + 1.0) * (r + 1.0) / 8.0;
          return ndv / (ndv * (1.0 - k) + k);
        }
        
        fn G_Smith(nDotL: f32, nDotV: f32, roughness: f32) -> f32 {
          return G_Schlick_GGX_G1(nDotL, roughness) * G_Schlick_GGX_G1(nDotV, roughness);
        }
        
        fn setBaseColor(globalInfo:MaterialInfo,uv:vec2f)->MaterialInfo{
            var info=globalInfo;
            info.baseColor=materialFactors.baseColor.rgb;
            info.baseColorAlpha=materialFactors.baseColor.a;
            
            ${overrides.HAS_BASE_COLOR_MAP ? `
            let sampledTex=textureSample(baseColorTexture,[[albedo.sampler]],uv);
            info.baseColor *=sampledTex.rgb;
            info.baseColorAlpha *=sampledTex.a;
            ` : ``}
            
            return info;
        }
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
            ` : ``}
            
            ${overrides.HAS_TANGENT_VEC4 ? `
            skinnedTangent += vec4f((boneMatrix3 * in.tangent.xyz) * weight,in.tangent.w * weight);
            ` : ``}
        }
    }

    return skinOutput(
        skinnedPos,
        skinnedNormal,
        skinnedTangent
    );
}
` : ``}

fn getInfo(in: vsIn) -> Info {
    var output: Info;

    ${overrides.HAS_SKIN ? `
        let skinData = skinMat(in);
        output.worldPos = modelMatrix * skinData.skinPos;
    ` : `
        output.worldPos = modelMatrix * vec4f(in.pos, 1.0);
    `}
    var T=vec3f(0);
    var B=vec3f(0);
    var N=vec3f(0);
    
    ${overrides.HAS_NORMAL_VEC3 ? `
        let normalMatrix =mat3x3<f32>(
            normalMatrix4[0].xyz,
            normalMatrix4[1].xyz,
            normalMatrix4[2].xyz
        );
        N=normalize(normalMatrix * in.normal);
    ` : ""}    
        
    ${overrides.HAS_TANGENT_VEC4 ? `
        ${overrides.HAS_SKIN ? `
    N = skinData.skinNormal;
    var tangentDir = skinData.skinTangent.xyz;
    T = normalize(tangentDir - N * dot(N, tangentDir));
    
    B = cross(N, T) * skinData.skinTangent.w;
    B = normalize(B);
    
    ` : `
    T = normalize(normalMatrix * in.tangent.xyz);
    N = normalize(normalMatrix * in.normal.xyz);
    T = normalize(T - N * dot(N, T));
    
    B = cross(N, T) * in.tangent.w;
    B = normalize(B);
        `}
    ` : ``}

    output.N = N;
    output.T = T;
    output.B = B;
    return output;
}
    `
}


export const ggxPrefilterCode = {
    vertex: `
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
    fragment: `
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

export const ggxBRDFLUTCode = {
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
    fragment: `
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








