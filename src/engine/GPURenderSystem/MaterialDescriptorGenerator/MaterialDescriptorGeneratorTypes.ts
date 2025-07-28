export enum StandardMaterialBindPoint {
    SAMPLER,
    FACTORS,
    BASE_COLOR,
    EMISSIVE,
    METALLIC = 4,
    ROUGHNESS = 4,
    NORMAL,
    OCCLUSION,
    CLEARCOAT,
    CLEARCOAT_ROUGHNESS,
    CLEARCOAT_NORMAL,
    SPECULAR,
    SPECULAR_COLOR,
    TRANSMISSION,
}

export enum RenderFlag {
    BASE_COLOR,
    EMISSIVE,
    OPACITY,
    OCCLUSION,
    NORMAL,
    METALLIC,
    ROUGHNESS,
    TRANSMISSION,
    SPECULAR,
    SPECULAR_COLOR,
    CLEARCOAT,
    CLEARCOAT_NORMAL,
    CLEARCOAT_ROUGHNESS,
}

export enum StandardMaterialFactorsStartPoint {
    BASE_COLOR = 0,
    EMISSIVE = 4,
    METALLIC = 7,
    ROUGHNESS = 8,
    NORMAL = 9,
    OCCLUSION = 10,
    SPECULAR = 11,
    SPECULAR_COLOR = 12,
    TRANSMISSION = 15,
    CLEARCOAT = 16,
    CLEARCOAT_ROUGHNESS = 17,
    CLEARCOAT_NORMAL = 18,
}

export enum PipelineShaderLocations {
    POSITION,
    UV,
    NORMAL,
    JOINTS,
    WEIGHTS,
    TANGENT
}