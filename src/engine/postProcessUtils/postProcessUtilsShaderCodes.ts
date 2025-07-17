import {PostProcessUtils, ToneMapping} from "./postProcessUtilsTypes.ts";

export const postProcessUtilsMap = new Map<PostProcessUtils, string>();
export const toneMappingMap = new Map<ToneMapping, {
    shader: string,
    functionName: string,
}>();

postProcessUtilsMap.set(PostProcessUtils.EXPOSURE, `
fn applyExposure(color: vec3f, exposure: f32) -> vec3f {
    return color * exposure;
}
`)
postProcessUtilsMap.set(PostProcessUtils.GAMMA_CORRECTION, `
fn applyGamma(color: vec3f, gamma: f32) -> vec3f {
    return pow(color, vec3f(1.0 / gamma));
}
`)
toneMappingMap.set(ToneMapping.NONE, {
    shader: `
fn toneMapNone(color: vec3f) -> vec3f {
    return color;
}
`,
    functionName: "toneMapNone"
})
toneMappingMap.set(ToneMapping.REINHARD, {
    shader:`
fn toneMapReinhard(color: vec3f) -> vec3f {
    return color / (color + vec3f(1.0));
}
`,
    functionName:'toneMapReinhard'
})

toneMappingMap.set(ToneMapping.REINHARD_MAX, {
    shader:`
fn toneMapReinhard2(color: vec3f) -> vec3f {
    let maxChannel = max(color.r, max(color.g, color.b));
    return color / (vec3f(1.0) + maxChannel);
}
`,
    functionName:'toneMapReinhard2'
})

toneMappingMap.set(ToneMapping.FILMIC, {
    shader:`
fn toneMapFilmicChannel(x: f32) -> f32 {
    let A = 0.15;
    let B = 0.50;
    let C = 0.10;
    let D = 0.20;
    let E = 0.02;
    let F = 0.30;
    return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}

fn toneMapFilmic(color: vec3f) -> vec3f {
    let W = 11.2;
    let whiteScale = toneMapFilmicChannel(W);
    return vec3f(
        toneMapFilmicChannel(color.r),
        toneMapFilmicChannel(color.g),
        toneMapFilmicChannel(color.b)
    ) / whiteScale;
}
`,
    functionName:'toneMapFilmic'
})
toneMappingMap.set(ToneMapping.ACES, {
    shader:`
fn toneMapACESChannel(x: f32) -> f32 {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
fn toneMapACES(color: vec3f) -> vec3f {
    return vec3f(
        toneMapACESChannel(color.r),
        toneMapACESChannel(color.g),
        toneMapACESChannel(color.b)
    );
}
`,
    functionName:'toneMapACES'
})
