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
    khronosNeutral:`
    fn toneMapping(color: vec3<f32>) -> vec3<f32> {
        let startCompression: f32 = 0.8 - 0.04;
        let desaturation: f32 = 0.15;
    
        let x: f32 = min(color.r, min(color.g, color.b));
        var offset: f32;
        if (x < 0.08) { 
            offset=x - 6.25 * x * x;
        } else { 
            offset=0.04;
        }
        var c: vec3<f32> = color - vec3<f32>(offset);
    
        let peak: f32 = max(c.r, max(c.g, c.b));
        if (peak < startCompression) {
            return c;
        }
    
        let d: f32 = 1.0 - startCompression;
        let newPeak: f32 = 1.0 - d * d / (peak + d - startCompression);
        c *= newPeak / peak;
    
        let g: f32 = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
        return mix(c, newPeak * vec3<f32>(1.0, 1.0, 1.0), g);
    }
    `,

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

fn getDiffuseTransmissionIBL(
n:vec3f,
diffuseTransmissionColor:vec3f,
diffuseTransmission:f32,
diffuseTransmissionThickness:vec3f,
attenuationColor:vec3f,
attenuationDistance:f32,
)->vec3f{

    var diffuseTransmissionIBL = textureSample(irradianceMap,iblSampler, -n).rgb * diffuseTransmissionColor;
    
    ${overrides.HAS_VOLUME ? `
    diffuseTransmissionIBL = applyVolumeAttenuation(diffuseTransmissionIBL, diffuseTransmissionThickness.r, attenuationColor, attenuationDistance);
    `:``}
    
    return diffuseTransmissionIBL;
}

fn getPunctualRadianceTransmission(F0_total:vec3f,normal: vec3<f32>, view: vec3<f32>, pointToLight: vec3<f32>, roughness: f32, baseColor: vec3<f32>, ior: f32) -> vec3<f32> {
    let alphaRoughness=roughness * roughness;
    let transmissionRougness: f32 = applyIorToRoughness(alphaRoughness, ior);
    let n: vec3<f32> = normalize(normal);
    let v: vec3<f32> = normalize(view);
    let l: vec3<f32> = normalize(pointToLight);
    let l_mirror: vec3<f32> = normalize(l + 2. * n * dot(-l, n));
    let h: vec3<f32> = normalize(l_mirror + v);
    let NoH=saturate(dot(n,h));
    let NoL=saturate(dot(n,l_mirror));
    let NoV=saturate(dot(n,v));
    let HoV=saturate(dot(h,v));
    let F    = fresnelSchlick(HoV, F0_total); 
    let NDF = D_GGX(NoH,alphaRoughness);        
    let G   = G_Smith(NoL,NoV,roughness); 
    let numerator    = NDF * G * F;
    let denominator = 4.0 * NoV * NoL + 1e-5;

    return baseColor * numerator / denominator;
} 



fn applyVolumeAttenuation(radiance: vec3<f32>, transmissionDistance: f32, attenuationColor: vec3<f32>, attenuationDistance: f32) -> vec3<f32> {
    if (attenuationDistance == 0.) {
        return radiance;
    } else { 
        let transmittance: vec3<f32> = pow(attenuationColor, vec3<f32>(transmissionDistance / attenuationDistance));
        return transmittance * radiance;
    }
} 

fn setDiffuseTransmission(globalInfo:MaterialInfo,uv:vec2f,colorUV:vec2f) -> MaterialInfo {
    var info:MaterialInfo= globalInfo;
    
    info.diffuseTransmission=materialFactors.diffuseTransmission;
    info.diffuseTransmissionColor=materialFactors.diffuseTransmissionColor;
    
    ${overrides.HAS_DIFFUSE_TRANSMISSION_MAP ? `
    let sampledTex=textureSample([[diffuse_transmission.texture]],[[diffuse_transmission.sampler]],uv,[[diffuse_transmission.textureIndex]]);
    info.diffuseTransmission *=sampledTex.a;
    `:``}
        
    ${overrides.HAS_DIFFUSE_TRANSMISSION_COLOR_MAP ? `
    let sampledTex=textureSample([[diffuse_transmission_color.texture]],[[diffuse_transmission_color.sampler]],uv,[[diffuse_transmission_color.textureIndex]]);
    info.diffuseTransmissionColor *=sampledTex.rgb;
    `:``}
    
    return info;
} 
fn setVolume(globalInfo:MaterialInfo,uv:vec2f) -> MaterialInfo {
    var info:MaterialInfo= globalInfo;
    
    info.thickness=materialFactors.thickness;
    info.attenuationColor=materialFactors.attenuationColor;
    info.attenuationDistance=materialFactors.attenuationDistance;
    
    ${overrides.HAS_THICKNESS_MAP ? `
    let sampledTex=textureSample([[thickness.texture]],[[thickness.sampler]],uv,[[thickness.textureIndex]]);
    info.thickness *=sampledTex.g;
    `:``}
    
    return info;
} 


fn getVolumeTransmissionRay(n: vec3<f32>, v: vec3<f32>, thickness: f32, ior: f32, modelMatrix: mat4x4<f32>) -> vec3<f32> {

    let refractionVector: vec3<f32> = refract(-v, n, 1. / ior);
    var modelScale: vec3<f32>;
    modelScale.x = length(vec3<f32>(modelMatrix[0].xyz));
    modelScale.y = length(vec3<f32>(modelMatrix[1].xyz));
    modelScale.z = length(vec3<f32>(modelMatrix[2].xyz));
    return normalize(refractionVector) * thickness * modelScale;
} 


fn applyIorToRoughness(roughness: f32, ior: f32) -> f32 {
    return roughness * clamp(ior * 2. - 2., 0., 1.);
} 

fn getTransmissionSample(fragCoord: vec2<f32>, roughness: f32, ior: f32) -> vec3<f32> {
    let levelCount=floor(log2(f32(max(textureDimensions(sceneBackgroundTexture,0).x,textureDimensions(sceneBackgroundTexture,0).y))));
    let framebufferLod=levelCount * applyIorToRoughness(roughness, ior);
    let transmittedLight: vec3<f32> = textureSampleLevel(sceneBackgroundTexture, iblSampler, fragCoord.xy, f32(framebufferLod)).rgb;
    return transmittedLight;
} 

fn getIBLVolumeRefraction(
n: vec3<f32>, 
v: vec3<f32>, 
perceptualRoughness: f32, 
baseColor: vec3<f32>, 
position: vec3<f32>, 
modelMatrix: mat4x4<f32>, 
viewMatrix: mat4x4<f32>, 
projMatrix: mat4x4<f32>, 
ior: f32, 
thickness: f32, 
attenuationColor: vec3<f32>, 
attenuationDistance: f32, 
dispersion: f32
) -> vec3<f32> {
    ${overrides.HAS_DISPERSION ? `
    let halfSpread: f32 = (ior - 1.) * 0.025 * dispersion;
    let iors: vec3<f32> = vec3<f32>(ior - halfSpread, ior, ior + halfSpread);
    var transmittedLight: vec3<f32>;
    var transmissionRayLength: f32;
    
    for (var i: i32 = 0; i < 3; i = i + 1) {
        var transmissionRay: vec3<f32> = getVolumeTransmissionRay(n, v, thickness, iors[i], modelMatrix);
        transmissionRayLength = length(transmissionRay);
        var refractedRayExit: vec3<f32> = position + transmissionRay;
        var ndcPos: vec4<f32> = projMatrix * viewMatrix * vec4<f32>(refractedRayExit, 1.);
        var refractionCoords: vec2<f32> = ndcPos.xy / ndcPos.w;
        refractionCoords = refractionCoords.xy * 0.5 + 0.5;
        refractionCoords = vec2f(refractionCoords.x,1.-refractionCoords.y);
        transmittedLight[i] = getTransmissionSample(refractionCoords, perceptualRoughness, iors[i])[i];
    }
    `:`
        let transmissionRay: vec3<f32> = getVolumeTransmissionRay(n, v, thickness, ior, modelMatrix);
        let transmissionRayLength: f32 = length(transmissionRay);
        let refractedRayExit: vec3<f32> = position + transmissionRay;
        let ndcPos: vec4<f32> = projMatrix * viewMatrix * vec4<f32>(refractedRayExit, 1.);
        var refractionCoords: vec2<f32> = ndcPos.xy / ndcPos.w;
        refractionCoords = refractionCoords.xy * 0.5 + 0.5;
        refractionCoords = vec2f(refractionCoords.x,1.-refractionCoords.y);
        let transmittedLight: vec3<f32> = getTransmissionSample(refractionCoords, perceptualRoughness, ior);
    `}
    
    let attenuatedColor: vec3<f32> = applyVolumeAttenuation(transmittedLight, transmissionRayLength, attenuationColor, attenuationDistance);
    return attenuatedColor * baseColor;
} 



fn getTransmission(
    v:vec3f,
    n:vec3f,
    NoV:f32,
    ior:f32,
    worldPos:vec3f,
    thickness:f32,
    roughness:f32
) -> vec3<f32> {
    let eta = select(ior, 1.0/ior, NoV < 0.0);
    let refracted = refract(-v, n, eta);

    let projectedPos = worldPos + refracted * thickness;
    let clip = projectionMatrix * viewMatrix * vec4f(projectedPos, 1.0);
    let ndc = clip.xyz / clip.w;    
    var screenUV = ndc.xy * 0.5 + 0.5; 
    screenUV = vec2f(screenUV.x,1.-screenUV.y);
    let levelCount=floor(log2(f32(max(textureDimensions(sceneBackgroundTexture,0).x,textureDimensions(sceneBackgroundTexture,0).y))));
    var color = textureSampleLevel(sceneBackgroundTexture, iblSampler, screenUV,roughness * f32(levelCount));
    
    return vec3f(color.rgb);
}

        const XYZ_TO_REC709 = mat3x3f(
             3.2404542, -0.9692660,  0.0556434,
            -1.5371385,  1.8760108, -0.2040259,
            -0.4985314,  0.0415560,  1.0572252
        );
        fn snellLaw(outsideIor:f32,iridescenceIor:f32,cosTheta1:f32)->f32{
            let sinTheta2Sq = pow(outsideIor / iridescenceIor, 2.0) * (1.0 - pow(cosTheta1, 2.0));
            let cosTheta2Sq = 1.0 - sinTheta2Sq;
            
            if (cosTheta2Sq < 0.0) {
                return -1.0;
            }
            
            return sqrt(max(0.0, 1.0 - sinTheta2Sq));
        }
        
        fn  calculateIridescenceF0(
        cosTheta1:f32,
        iridescenceIor:f32,
        outsideIOR:f32,
        baseF0:vec3f,
        iridescenceThickness:f32
        )->vec3f{
            let cosTheta2 = snellLaw(outsideIOR, iridescenceIor, cosTheta1);
            if (cosTheta2 < 0.0) { // TIR
                return vec3(1.0);
            }
            let R0 = dielectricIorToF0(iridescenceIor,outsideIOR);
            let R12 = fresnelSchlick(cosTheta1,vec3f(R0));
            let R21 = R12;
            let T121 = 1.0 - R12;

            let baseIor = dielectricIorToF0_vec3(baseF0 + 0.0001);
            let R1 = IorToFresnel0_vec3(baseIor, vec3f(iridescenceIor));
            let R23 = fresnelSchlick(cosTheta2,vec3f(R1));
            let OPD = 2.0 * iridescenceIor * iridescenceThickness * cosTheta2;
            
            // First interface
            var phi12 = 0.0;
            if (iridescenceIor < outsideIOR) {
                phi12 = PI;
            };
            let phi21 = PI - phi12;
            
            // Second interface
            var phi23 = vec3f(0.0);
            if (baseIor[0] < iridescenceIor){
                phi23[0] = PI;
            }
            if (baseIor[1] < iridescenceIor){
                phi23[1] = PI;
            }
            if (baseIor[2] < iridescenceIor){
                phi23[2] = PI;
            }
            
            let phi = vec3f(phi21) + phi23;
            
            // Compound terms
            let R123 = clamp(R12 * R23, vec3f(1e-5), vec3f(0.9999));
            let r123 = sqrt(R123);
            let Rs = pow(T121,vec3f(2.)) * R23 / (vec3(1.0) - R123);
            
            // Reflectance term for m = 0 (DC term amplitude)
            let C0 = R12 + Rs;
            var I = C0;
            
            // Reflectance term for m > 0 (pairs of diracs)
            var Cm = Rs - T121;
            for (var m = 1; m <= 2; m++)
            {
                Cm *= r123;
                let Sm = 2.0 * evalSensitivity(f32(m) * OPD, f32(m) * phi);
                I += Cm * Sm;
            }
                        
            return max(I, vec3(0.0));
        }
        
        fn evalSensitivity(OPD:f32,shift:vec3f)->vec3f {
            let phase = 2.0 * PI * OPD * 1.0e-9;
            let val = vec3f(5.4856e-13, 4.4201e-13, 5.2481e-13);
            let pos = vec3f(1.6810e+06, 1.7953e+06, 2.2084e+06);
            let variable = vec3f(4.3278e+09, 9.3046e+09, 6.6121e+09);
        
            var xyz = val * sqrt(2.0 * PI * variable) * cos(pos * phase + shift) * exp(-1 * pow(phase,2.) * variable);
            xyz.x += 9.7470e-14 * sqrt(2.0 * PI * 4.5282e+09) * cos(2.2399e+06 * phase + shift[0]) * exp(-4.5282e+09 * pow(phase,2.));
            xyz /= 1.0685e-7;
        
            return XYZ_TO_REC709 * xyz;
        }
        
        fn IorToFresnel0_vec3(transmittedIor:vec3f,incidentIor:vec3f)->vec3f {
            return pow((transmittedIor - incidentIor) / (transmittedIor + incidentIor), vec3(2.0));
        }

        fn dielectricIorToF0_vec3(F0:vec3f)->vec3f {
            let sqrtF0 = sqrt(F0);
            return (vec3(1.0) + sqrtF0) / (vec3(1.0) - sqrtF0);
        }
        
        
        
        fn  setIridescence(globalInfo:MaterialInfo,thicknessUV:vec2f,iridescenceUV:vec2f)->MaterialInfo{
            var info=globalInfo;
            info.iridescence = materialFactors.iridescence;
            info.iridescenceThickness = materialFactors.maximumIridescenceThickness;
            info.iridescenceIOR = materialFactors.iridescenceIor;
            
            ${overrides.HAS_IRIDESCENCE_MAP?`
            let iridescenceTex = textureSample([[iridescence.texture]],[[iridescence.sampler]],iridescenceUV,[[iridescence.textureIndex]]);
            info.iridescence *= iridescenceTex.r;
            `:``}            
            
            ${overrides.HAS_IRIDESCENCE_THICKNESS_MAP?`
            let iridescenceThicknessTex = textureSample([[iridescence_thickness.texture]],[[iridescence_thickness.sampler]],thicknessUV,[[iridescence_thickness.textureIndex]]);
            info.iridescenceThickness = mix(materialFactors.minimumIridescenceThickness,materialFactors.maximumIridescenceThickness,iridescenceThicknessTex.g);
            `:``}
            
            return info;
        }
        
        fn D_GGX_Aniso(ToH: f32, BoH: f32, NoH: f32, at: f32, ab: f32) -> f32 {
            let invAt2 = 1.0 / (at * at);
            let invAb2 = 1.0 / (ab * ab);
        
            let e = ToH * ToH * invAt2 + BoH * BoH * invAb2 + NoH * NoH;
            return 1.0 / (PI * at * ab * e * e + 1e-7);
        }
        
        fn G1_GGX_Aniso(NoW: f32, ToW: f32, BoW: f32, at: f32, ab: f32) -> f32 {
            // NoW must be > 0 for a meaningful result; caller should guard with saturate
            let num = ToW * ToW * (at * at) + BoW * BoW * (ab * ab);
            let denom = max(NoW * NoW, 1e-7);
            let k = num / denom;
            return 2.0 / (1.0 + sqrt(1.0 + k));
        }
        
        fn G_Smith_Aniso(NoL: f32, NoV: f32,
                         ToV: f32, BoV: f32,
                         ToL: f32, BoL: f32,
                         at: f32, ab: f32) -> f32 {
            return G1_GGX_Aniso(NoL, ToL, BoL, at, ab) * G1_GGX_Aniso(NoV, ToV, BoV, at, ab);
        }

        
    
        fn setAnisotropy(globalInfo:MaterialInfo,uv:vec2f,TBN:mat3x3f,n:vec3f)->MaterialInfo{
            var info=globalInfo;
            
            info.anisotropyStrength=materialFactors.anisotropy.z;
            var direction = materialFactors.anisotropy.xy;
            
            ${overrides.HAS_ANISOTROPY_MAP ? `
            let anisotropyTex = textureSample([[anisotropy.texture]],[[anisotropy.sampler]],uv,[[anisotropy.textureIndex]]).rgb;
            direction = anisotropyTex.rg * 2.0 - vec2(1.0);
            direction = mat2x2f(direction.x, direction.y, -direction.y, direction.x) * normalize(direction);
            info.anisotropyStrength *= anisotropyTex.b;
            `:``}   
            
            info.anisotropicT = normalize(TBN * vec3f(direction, 0.0));
            info.anisotropicB = normalize(cross(n, info.anisotropicT));
            
            return info;
        }
        fn setTransmission(globalInfo:MaterialInfo,uv:vec2f)->MaterialInfo{
            var info=globalInfo;
            info.transmissionWeight=materialFactors.transmission;
              
            ${overrides.HAS_TRANSMISSION_MAP ? `
            let sampledTex=textureSample([[transmission.texture]],[[transmission.sampler]],uv,[[transmission.textureIndex]]);
            info.transmissionWeight *=sampledTex.r;
            `:``}       
            
            return info;
        }
        fn setSpecular(globalInfo:MaterialInfo,specularUV:vec2f,specularColorUV:vec2f)->MaterialInfo{
            var info=globalInfo;
            
            info.specular=materialFactors.specular;
            info.specularColor=materialFactors.specularColor;
            
            ${overrides.HAS_SPECULAR_MAP ? `
            let sampledSpecular=textureSample([[specular.texture]],[[specular.sampler]],specularUV,[[specular.textureIndex]]);
            info.specular *=sampledSpecular.a;
            `:``}               
            
            ${overrides.HAS_SPECULAR_COLOR_MAP ? `
            let sampledSpecularColor=textureSample([[specular_color.texture]],[[specular_color.sampler]],specularColorUV,[[specular_color.textureIndex]]);
            info.specularColor *=sampledSpecularColor.rgb;
            `:``}   
            
            return info;
        }
    
        fn buildTBN(N:vec3f, T:vec3f,tangentW:f32)->mat3x3f {
            let Nn = normalize(N);
            var Tn = normalize(T);
            Tn = normalize(Tn - Nn * dot(Nn, Tn)); 
            let Bn = cross(Nn, Tn) * tangentW;
            
            return mat3x3f(Tn, Bn, Nn);
        }
        fn charlieLUTSampler(roughness:f32,dotP:f32)->f32{
            return textureSample(charlieLUT,iblSampler, vec2f(dotP, roughness)).r;
        }

        fn max3(v:vec3f)->f32 { return max(max(v.x, v.y), v.z); }
        
        fn setSheen(globalInfo:MaterialInfo,sheenUV:vec2f,sheenRoughness:vec2f)->MaterialInfo{
            var info=globalInfo;
            info.sheenColor=materialFactors.sheenColor;
            info.sheenRoughness=materialFactors.sheenRoughness;
            
            ${overrides.HAS_SHEEN_COLOR_MAP ? `
            let sampledSheenColor=textureSample([[sheen_color.texture]],[[sheen_color.sampler]],sheenUV,[[sheen_color.textureIndex]]);
            info.sheenColor *=sampledSheenColor.rgb;
            `:``}   
                     
            ${overrides.HAS_SHEEN_ROUGHNESS_MAP ? `
            let sampledSheenRoughness=textureSample([[sheen_roughness.texture]],[[sheen_roughness.sampler]],sheenUV,[[sheen_roughness.textureIndex]]);
            info.sheenRoughness *=sampledSheenRoughness.a;
            `:``}
            
            info.sheenRoughness=max(1e-4,info.sheenRoughness);
            return info;
        }

        fn D_Charlie(a: f32, NoH: f32) -> f32 {
            let invR = 1.0 / a;
            let cos2h = NoH * NoH;
            let sin2h = 1.0 - cos2h;
            return (2.0 + invR) * pow(sin2h, invR * 0.5) / (2.0 * PI);
        }
        
        fn L_curve(x: f32, r: f32) -> f32 {
          let t = (1.0 - r) * (1.0 - r);
          let a = mix(21.5473, 25.3245, t);
          let b = mix(3.82987, 3.32435, t);
          let c = mix(0.19823, 0.16801, t);
          let d = mix(-1.97760, -1.27393, t);
          let e = mix(-4.32054, -4.85967, t);
          return a / (1.0 + b * pow(x, c)) + d * x + e;
        }
        
        fn lambda_sheen(cosTheta: f32, a: f32) -> f32 {
          let x = clamp(cosTheta, 0.0, 1.0);
          var Lx:f32;
          if (x < 0.5) { 
            Lx=L_curve(x, a) ;
          } else { 
            Lx=2.0 * L_curve(0.5, a) - L_curve(1.0 - x, a);
          };
          return exp(Lx);
        }
        
        fn V_Charlie(a: f32, NoV: f32, NoL: f32) -> f32 {
          let nv = max(NoV, 1e-4);
          let nl = max(NoL, 1e-4);
          let G = 1.0 / (1.0 + lambda_sheen(nv, a) + lambda_sheen(nl, a));
          
          return saturate(G / (4.0 * nv * nl));
        }


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
            info.clearcoatF0=vec3f(dielectricIorToF0(ior,1.));
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
            info.emissive *=materialFactors.emissiveStrength;
            return info;
        }
        
        ${GAMMA_CORRECTION}
        
        struct IBLOutput{
            diffuse:vec3f,
            specular:vec3f
        }
        
        fn getIBL(
        baseColor:vec3f,
        metallic:f32,
        n:vec3f,
        r:vec3f,
        NoV:f32,
        F:vec3f,
        roughness:f32,
        ao:f32,
        )->IBLOutput{
            let irradiance = textureSample(irradianceMap,iblSampler, n).rgb;
            let diffuse    = irradiance * baseColor;
            
            let kS = F;
            var kD = 1.0 - kS;
            kD *= 1.0 - metallic;
            
            let prefilteredColor = textureSampleLevel(ggxPrefilterMap,iblSampler, r,  roughness * f32(ENV_MAX_LOD_COUNT)).rgb;   
            let envBRDF  = textureSample(ggxLUT,iblSampler, vec2f(NoV, roughness)).rg;
            let specular = prefilteredColor * (F * envBRDF.x + envBRDF.y);
            return IBLOutput(kD * diffuse,specular * ao);
        }
        
        fn      getClearcoatIBL(
        r: vec3f,
        NoV: f32,
        F: vec3f,
        roughness: f32
    ) -> vec3f {
        let pR = roughness * roughness;
    
        let maxLod = f32(ENV_MAX_LOD_COUNT);
        let lod = clamp(pR * maxLod, 0.0, maxLod);
    
        let prefilteredColor = textureSampleLevel(ggxPrefilterMap, iblSampler, r, lod).rgb;
    
        let uv = vec2f(clamp(NoV, 0.0, 1.0), clamp(roughness, 0.0, 1.0));
        let envBRDF = textureSample(ggxLUT, iblSampler, uv).rg;
    
        let specular = prefilteredColor * (F * envBRDF.x + vec3f(envBRDF.y));
        return specular;
    }
 
        
        fn getSheenIBL(
        r:vec3f,
        NoV:f32,
        roughness:f32,
        )->vec3f{
            let prefilteredColor = textureSampleLevel(charliePrefilterMap,iblSampler, r,  roughness * f32(ENV_MAX_LOD_COUNT)).rgb;   
            let envBRDF  = textureSample(charlieLUT,iblSampler, vec2f(NoV, roughness)).r;
            return prefilteredColor * envBRDF;
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
        
        fn dielectricIorToF0(transmittedIor:f32,incidentIor:f32)->f32{
            return pow((incidentIor - transmittedIor) / (incidentIor + transmittedIor),2);
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
        
        fn setSpecularGlossinessDiffuse(globalInfo:MaterialInfo,uv:vec2f)->MaterialInfo{
            var info=globalInfo;

            info.baseColor=materialFactors.pbrSpecularGlossinessDiffuse.rgb;
            info.baseColorAlpha=materialFactors.pbrSpecularGlossinessDiffuse.a;
                
            ${overrides.HAS_SPECULAR_GLOSSINESS_DIFFUSE_MAP ? `
                let sampledTex=textureSample([[specular_glossiness_diffuse.texture]],[[specular_glossiness_diffuse.sampler]],uv,[[specular_glossiness_diffuse.textureIndex]]);
                info.baseColor *=sampledTex.rgb;
                info.baseColorAlpha *=sampledTex.a;
            ` : ``}
            
            return info;
        }    
        
        fn setSpecularGlossiness(globalInfo:MaterialInfo,uv:vec2f)->MaterialInfo{
            var info=globalInfo;
            
            info.metallic=0.;
            info.perceptualRoughness=1. - materialFactors.pbrGlossiness;
            info.f0=materialFactors.pbrSpecular;
            
            ${overrides.HAS_SPECULAR_GLOSSINESS_MAP ? `
            let sampledTex=textureSample([[specular_glossiness.texture]],[[specular_glossiness.sampler]],uv,[[specular_glossiness.textureIndex]]);
            info.perceptualRoughness *=1.- sampledTex.a;
            info.f0 *=sampledTex.rgb;
            `:``}
            info.alphaRoughness=info.perceptualRoughness * info.perceptualRoughness;
            
            return info;
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
    var T=vec4f(0);
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
    N = normalize(normalMatrix * skinData.skinNormal);
    T = vec4(normalize(normalMatrix * skinData.skinTangent.xyz), skinData.skinTangent.w);  
    ` : `
    N = normalize(normalMatrix * in.normal);
    T = vec4(normalize(normalMatrix * in.tangent.xyz), in.tangent.w);
        `}
    ` : ``}

    output.N = N;
    output.T = T;
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

export const charlieBRDFLUTCode = {
    vertex: `
    struct VertexOutput {
      @builtin(position) Position: vec4f,
      @location(0) uv: vec2f,
    }

    @vertex
    fn main(@location(0) position: vec2f, @location(1) uv: vec2f) -> VertexOutput {
      var output: VertexOutput;
      output.Position = vec4f(position, 0.0, 1.0);
      output.uv = uv;
      return output;
    }
  `,
    fragment: `
    const PI: f32 = 3.14159265359;

    // radical inverse + hammersley (same approach as your GGX LUT helpers)
    fn RadicalInverse_VdC(bits: u32) -> f32 {
      var b = bits;
      b = (b << 16u) | (b >> 16u);
      b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u);
      b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u);
      b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u);
      b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u);
      return f32(b) * 2.3283064365386963e-10;
    }

    fn hammersley(i: u32, N: u32) -> vec2f {
      return vec2f(f32(i) / f32(N), RadicalInverse_VdC(i));
    }

    // cosine-weighted hemisphere sample (used for LUT integrator)
    fn sampleCosineHemisphere(xi: vec2f) -> vec3f {
      let r = sqrt(xi.x);
      let phi = 2.0 * PI * xi.y;
      let x = r * cos(phi);
      let y = r * sin(phi);
      let z = sqrt(max(0.0, 1.0 - xi.x));
      return vec3f(x, y, z);
    }

    // Charlie curve l(x,a)
    fn l_curve(x: f32, a: f32) -> f32 {
      let t = (1.0 - a) * (1.0 - a);
      let A = mix(21.5473, 25.3245, t);
      let B = mix(3.82987, 3.32435, t);
      let C = mix(0.19823, 0.16801, t);
      let D = mix(-1.97760, -1.27393, t);
      let E = mix(-4.32054, -4.85967, t);
      return A / (1.0 + B * pow(x, C)) + D * x + E;
    }

    fn lambda_sheen(cosTheta: f32, a: f32) -> f32 {
      let x = clamp(cosTheta, 0.0, 1.0);
      if (x < 0.5) {
        return exp(l_curve(x, a));
      } else {
        return exp(2.0 * l_curve(0.5, a) - l_curve(1.0 - x, a));
      }
    }

    fn V_Charlie(a: f32, NoV: f32, NoL: f32) -> f32 {
      let nv = max(NoV, 1e-6);
      let nl = max(NoL, 1e-6);
      let lamV = lambda_sheen(nv, a);
      let lamL = lambda_sheen(nl, a);
      return 1.0 / ((1.0 + lamV + lamL) * (4.0 * nv * nl));
    }

    fn D_Charlie(a: f32, NoH: f32) -> f32 {
      let rr = max(a, 1e-4);
      let inv_r = 1.0 / rr;
      let cos2h = NoH * NoH;
      let sin2h = max(1.0 - cos2h, 0.0);
      return (2.0 + inv_r) * pow(sin2h, 0.5 * inv_r) / (2.0 * PI);
    }

    // Integrator: cosine-weighted hemisphere sampling simplifies the estimator:
    // E = PI * average_over_samples( D * V )
    fn integrateCharlie(NdotV: f32, roughness: f32) -> f32 {
      var V: vec3f;
      V.x = sqrt(max(0.0, 1.0 - NdotV * NdotV));
      V.y = 0.0;
      V.z = NdotV;

      let N = vec3f(0.0, 0.0, 1.0);

      var sum: f32 = 0.0;

      // match your GGX sample count style
      let SAMPLE_COUNT: u32 = 1024u;
      for (var i: u32 = 0u; i < SAMPLE_COUNT; i = i + 1u) {
        let Xi: vec2f = hammersley(i, SAMPLE_COUNT);
        let L_local: vec3f = sampleCosineHemisphere(Xi);
        let L: vec3f = L_local; // N=(0,0,1) tangent frame
        let NoL = max(dot(N, L), 0.0);
        let H = normalize(V + L);
        let NoH = clamp(dot(N, H), 0.0, 1.0);

        let D = D_Charlie(roughness, NoH);
        let Vterm = V_Charlie(roughness, NdotV, NoL);
        sum = sum + D * Vterm;
      }

      let E = PI * (sum / f32(SAMPLE_COUNT));
      // keep same return shape as your GGX LUT (vec2f)
      return E;
    }

    @fragment
    fn main(@location(0) uv: vec2f) -> @location(0) f32 {
      // follow GGX LUT mapping: integrateBRDF(uv.x, 1 - uv.y)
      let NdotV = clamp(uv.x, 0.0, 1.0);
      let roughness = clamp(1.0 - uv.y, 0.0, 1.0);
      let result = integrateCharlie(NdotV, roughness);
      return result;
    }
  `
};


export const charliePrefilterCode = {
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
      let worldPosition: vec4f = vec4f(position, 1.0);
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

    const PI: f32 = 3.14159265359;

    // ---------------- Charlie NDF (D), lambda, and V (Gs) ----------------
    fn l_curve(x: f32, a: f32) -> f32 {
      let t = (1.0 - a) * (1.0 - a);
      let A = mix(21.5473, 25.3245, t);
      let B = mix(3.82987, 3.32435, t);
      let C = mix(0.19823, 0.16801, t);
      let D = mix(-1.97760, -1.27393, t);
      let E = mix(-4.32054, -4.85967, t);
      return A / (1.0 + B * pow(x, C)) + D * x + E;
    }

    fn lambda_sheen(cosTheta: f32, a: f32) -> f32 {
      let x = clamp(cosTheta, 0.0, 1.0);
      if (x < 0.5) {
        return exp(l_curve(x, a));
      } else {
        return exp(2.0 * l_curve(0.5, a) - l_curve(1.0 - x, a));
      }
    }

    // G_s = 1 / (1 + lambda_v + lambda_l)
    // V = G_s / (4 * NoV * NoL)
    fn V_Charlie(a: f32, NoV: f32, NoL: f32) -> f32 {
      let nv = max(NoV, 1e-6);
      let nl = max(NoL, 1e-6);
      let lamV = lambda_sheen(nv, a);
      let lamL = lambda_sheen(nl, a);
      return 1.0 / ((1.0 + lamV + lamL) * (4.0 * nv * nl));
    }

    fn D_Charlie(a: f32, NoH: f32) -> f32 {
      let rr = max(a, 1e-4);
      let inv_r = 1.0 / rr;
      let cos2h = NoH * NoH;
      let sin2h = max(1.0 - cos2h, 0.0);
      return (2.0 + inv_r) * pow(sin2h, 0.5 * inv_r) / (2.0 * PI);
    }
    // --------------------------------------------------------------------

    // ------------------ Hammersley / RadicalInverse ----------------------
    fn RadicalInverse_VdC(bits: u32) -> f32 {
      var b = bits;
      b = (b << 16u) | (b >> 16u);
      b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u);
      b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u);
      b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u);
      b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u);
      return f32(b) * 2.3283064365386963e-10;
    }

    fn hammersley(i: u32, N: u32) -> vec2f {
      return vec2f(f32(i) / f32(N), RadicalInverse_VdC(i));
    }
    // --------------------------------------------------------------------

    // Minimal numeric guards (kept tiny to preserve behaviour)
    const EPS_XI: f32 = 1e-6;
    const EPS_PDF: f32 = 1e-8;
    const EPS_WEIGHT: f32 = 1e-6;

    // Importance-sample Charlie half-vector H.
    // Standard derivation: for p = 1/a, exponent = p + 2, sinTheta = xi.x^(1/(p+2)), phi = 2π xi.y.
    fn importanceSampleCharlie(xi: vec2f, N: vec3f, a: f32) -> vec3f {
      // protect xi.x from exact 0 or 1 which can produce degenerate values
      let x = clamp(xi.x, EPS_XI, 1.0 - EPS_XI);
      let y = xi.y;

      let aa = max(a, 1e-4);
      let p = 1.0 / aa; // p = 1/a
      let exponent = p + 2.0;

      let sinTheta = pow(x, 1.0 / exponent);
      let cosTheta = sqrt(max(0.0, 1.0 - sinTheta * sinTheta));
      let phi = 2.0 * PI * y;

      // H in tangent space (N = (0,0,1))
      let Ht = vec3f(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);

      // build tangent/bitangent using same approach as your GGX shader
      var up = vec3f(0.0, 0.0, 1.0);
      if (abs(N.z) > 0.999) {
        up = vec3f(1.0, 0.0, 0.0);
      }
      let tangent = normalize(cross(up, N));
      let bitangent = cross(N, tangent);

      // transform to world space
      let H = normalize(Ht.x * tangent + Ht.y * bitangent + Ht.z * N);
      return H;
    }

    override SAMPLE_COUNT = 1024u;
    override TEXTURE_RESOLUTION = 1024.0;

    @fragment
    fn main(@location(0) worldPosition: vec3f) -> @location(0) vec4f {
      // same orientation mapping as your GGX shader
      var n = normalize(vec3f(worldPosition.x, -worldPosition.y, worldPosition.z));

      // same simplifying assumption: V == R == N (keeps your pipeline identical)
      let v = n;

      var prefilteredColor = vec3f(0.0, 0.0, 0.0);
      var totalWeight: f32 = 0.0;

      let SAMPLES: u32 = max(SAMPLE_COUNT, 1u);
      for (var i: u32 = 0u; i < SAMPLES; i = i + 1u) {
        let xi = hammersley(i, SAMPLES);

        // importance-sample half-vector using Charlie distribution
        let h = importanceSampleCharlie(xi, n, uniforms.roughness);
        let l = normalize(2.0 * dot(v, h) * h - v);

        let nDotL = clamp(dot(n, l), 0.0, 1.0);
        if (nDotL <= 0.0) {
          continue;
        }

        // compute D, nDotH, hDotV exactly like the GGX flow
        let nDotH = max(dot(n, h), 0.0);
        let hDotV = max(dot(h, v), EPS_PDF); // avoid zero in denominator

        let d_val = D_Charlie(uniforms.roughness, nDotH);

        // same pdf mapping used in GGX -> L mapping
        var pdf = d_val * nDotH / (4.0 * hDotV);
        pdf = max(pdf, EPS_PDF);

        // same solid-angle / mip selection logic as your GGX shader
        let saTexel = 4.0 * PI / (6.0 * TEXTURE_RESOLUTION * TEXTURE_RESOLUTION);
        let saSample = 1.0 / (f32(SAMPLES) * pdf + EPS_PDF);

        // stable mip computation and preserve exact formula you used
        var mipLevel = 0.5 * log2(max(saSample / saTexel, EPS_PDF)) + 1.0;
        let maxMip = max(0.0, floor(log2(TEXTURE_RESOLUTION)));
        mipLevel = clamp(mipLevel, 0.0, maxMip);

        let sampleColor = textureSampleLevel(environmentMap, environmentSampler, l, mipLevel).rgb;

        // accumulation unchanged
        prefilteredColor = prefilteredColor + sampleColor * nDotL;
        let weight = D_Charlie(uniforms.roughness, nDotH) * 
                     V_Charlie(uniforms.roughness, max(dot(n, v), 0.0), nDotL) * 
                     nDotL;
        prefilteredColor += sampleColor * weight;
        totalWeight += weight;     
     }

      // final normalization (same weighting, protect against zero)
      if (totalWeight <= EPS_WEIGHT) {
        return vec4f(vec3f(0.0, 0.0, 0.0), 1.0);
      }
      prefilteredColor = prefilteredColor / totalWeight;
      return vec4f(prefilteredColor, 1.0);
    }
  `
};










