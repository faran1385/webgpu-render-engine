export const distributionGGX = /* wgsl */ `
fn distributionGGX(n: vec3f, h: vec3f, roughness: f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let nDotH = max(dot(n, h), 0.0);
  let nDotH2 = nDotH * nDotH;
  var denom = (nDotH2 * (a2 - 1.0) + 1.0);
  denom = PI * denom * denom;
  return a2 / denom;
}
`;

export const geometrySchlickGGX = /* wgsl */ `
fn geometrySchlickGGX(nDotV: f32, roughness: f32) -> f32 {
  let r = (roughness + 1.0);
  let k = (r * r) / 8.0;
  return nDotV / (nDotV * (1.0 - k) + k);
}
`;

export const geometrySmith = /* wgsl */ `
fn geometrySmith(n: vec3f, v: vec3f, l: vec3f, roughness: f32) -> f32 {
  let nDotV = max(dot(n, v), 0.0);
  let nDotL = max(dot(n, l), 0.0);
  let ggx2 = geometrySchlickGGX(nDotV, roughness);
  let ggx1 = geometrySchlickGGX(nDotL, roughness);
  return ggx1 * ggx2;
}
`;

export const fresnelSchlick = /* wgsl */ `
fn fresnelSchlick(cosTheta: f32, f0: vec3f) -> vec3f {
  return f0 + (1.0 - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
`;

export const fresnelSchlickRoughness = /* wgsl */ `
fn fresnelSchlickRoughness(cosTheta: f32, f0: vec3f, roughness: f32) -> vec3f {
  return f0 + (max(vec3(1.0 - roughness), f0) - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
`;

export const radicalInverseVdC = /* wgsl */ `
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
