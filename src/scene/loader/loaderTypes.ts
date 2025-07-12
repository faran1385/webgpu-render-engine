import {Material, TypedArray, vec2, vec4} from "@gltf-transform/core";
import {vec3} from "gl-matrix";


export type LODRange = { start: number; count: number, };
export type AttributeData = { array: TypedArray; itemSize: number };
export type LoaderOptions = { useCache?: boolean; onProgress?: (loaded: number, total: number) => void };

/** Type definitions */
export type MeshData = {
    nodeName: string;
    localMatrix: Float32Array;
    normalMatrix: Float32Array;
    geometry: GeometryData[];
    meshId: number,
    skinId: null | number
};

export type GeometryData = {
    dataList: Map<string, AttributeData>;
    indices?: TypedArray;
    indexType: 'uint16' | 'uint32' | 'Unknown';
    indexCount: number;
    lodRanges?: LODRange[]
};


export type MaterialData = {
    base: {
        texture: {
            array: Uint8Array | null,
            size: vec2
        } | null,
        factor: vec4
    },
    emissive: {
        texture: {
            array: Uint8Array | null,
            size: vec2
        } | null,
        factor: vec3
    },
    occlusion: {
        texture: {
            array: Uint8Array | null,
            size: vec2
        } | null,
        strength: number
    },
    normal: {
        texture: {
            array: Uint8Array | null,
            size: vec2
        } | null,
        scale: number
    },
    alpha: {
        mode: "BLEND" | "OPAQUE" | "MASK",
        value: number,
        cutoffAlpha: number
    },
    metallicRoughness: {
        texture: {
            array: Uint8Array | null,
            size: vec2
        } | null,
        factor: [number, number]
    },
    doubleSided: boolean
} & MaterialExtension

export type MaterialExtension = {
    clearcoat: {
        texture: {
            array: Uint8Array | null,
            size: [number, number]
        } | null,
        factor: number,
        normalTexture: {
            array: Uint8Array | null,
            size: [number, number]
        } | null,
        normalScale: number,
        roughnessTexture: {
            array: Uint8Array | null,
            size: [number, number]
        } | null,
        roughnessFactor: number,
    } | null,
    transmission: {
        texture: {
            array: Uint8Array | null,
            size: [number, number]
        } | null,
        factor: number
    } | null,
    glossiness: {
        texture: {
            array: Uint8Array | null,
            size: [number, number]
        } | null,
        factor: number
    } | null,
    specular: {
        texture: {
            array: Uint8Array | null,
            size: [number, number]
        } | null,
        factor: number
    } | null,
    specularColor: {
        texture: {
            array: Uint8Array | null,
            size: [number, number]
        } | null,
        factor: [number, number, number]
    } | null,
    glossinessSpecular: {
        texture: {
            array: Uint8Array | null,
            size: [number, number]
        } | null,
        factor: [number, number, number]
    } | null,
    emissiveStrength: number | null,
    unlit: boolean,
}


export interface DecodedMaterialFlags {
    hasBaseColorTexture: boolean;
    hasEmissiveTexture: boolean;
    hasOcclusionTexture: boolean;
    hasNormalTexture: boolean;
    hasMetallicRoughnessTex: boolean;
    hasTransmissionTexture: boolean;
    hasGlossinessTexture: boolean;
    hasSpecularTexture: boolean;
    hasSpecularColorTexture: boolean;
    hasGlossinessSpecularTexture: boolean;
    hasClearcoatTexture: boolean;
    hasClearcoatRoughnessTexture: boolean;
    hasClearcoatNormalTexture: boolean;
    hasSampler: boolean;

    alphaMode: 'opaque' | 'mask' | 'blend';

    unlit: boolean;
}

export interface DecodedPipelineFlags {
    doubleSided: boolean,
    alphaMode: "opaque" | "mask" | "blend",
    hasUv: boolean,
    hasNormal: boolean,
    shaderCode: string
}

export interface DecodedGeometryLayout {
    hasNormal: boolean,
}

export const enum MaterialFlags {
    HasBaseColorTexture = 1 << 0,
    HasEmissiveTexture = 1 << 1,
    HasOcclusionTexture = 1 << 2,
    HasNormalTexture = 1 << 3,
    HasMetallicRoughnessTex = 1 << 4,
    HasTransmissionTexture = 1 << 5,
    HasGlossinessTexture = 1 << 6,
    HasSpecularTexture = 1 << 7,
    AlphaMode_Mask = 0b11 << 8, // 2 bits (8–9)
    AlphaMode_Opaque = 0 << 8,
    AlphaMode_MaskOnly = 1 << 8,
    AlphaMode_Blend = 2 << 8,
    IsUnlit = 1 << 10,
    HasGlossinessSpecularTexture = 1 << 11,
    HasSpecularColorTexture = 1 << 12,
    HasClearcoatTexture = 1 << 13,
    HasClearcoatRoughnessTexture = 1 << 14,
    HasClearcoatNormalTexture = 1 << 15,
}

export const enum PipelineFlags {
    AlphaMode_Mask = 0b11 << 1,
    AlphaMode_Opaque = 0 << 1,
    AlphaMode_MaskOnly = 1 << 1,
    AlphaMode_Blend = 2 << 1,
    IsDoubleSided = 1 << 3,
    HasUV = 1 << 4,
    HasNORMAL = 1 << 5,
    BASE = 1 << 6,
    EMISSIVE = 1 << 7,
    OCCLUSION = 1 << 8,
    NORMAL = 1 << 9,
    METALLIC = 1 << 10,
    ROUGHNESS = 1 << 11,
    TRANSMISSION = 1 << 12,
    GLOSSINESS = 1 << 13,
    SPECULAR = 1 << 14,
    OPACITY = 1 << 15,
    GLOSSINESS_SPECULAR = 1 << 16,
    SPECULAR_FO = 1 << 17,
    CLEARCOAT = 1 << 18,
    CLEARCOAT_ROUGHNESS = 1 << 19,
    CLEARCOAT__NORMAL = 1 << 20,
}

export const enum ResourcesBindingPoints {
    FACTORS,
    BASE_COLOR_TEXTURE,
    EMISSIVE_TEXTURE,
    OCCLUSION_TEXTURE,
    NORMAL_TEXTURE,
    METALLIC_ROUGHNESS_TEXTURE,
    TRANSMISSION_TEXTURE,
    GLOSSINESS_TEXTURE,
    SPECULAR_TEXTURE,
    SAMPLER,
    ALPHA,
    GLOSSINESS_SPECULAR_TEXTURE,
    SPECULAR_FO_TEXTURE,
    CLEARCOAT_TEXTURE,
    CLEARCOAT_ROUGHNESS_TEXTURE,
    CLEARCOAT__NORMAL_TEXTURE,
}

export type RenderSetup = {
    materialPointer: Material
    bindGroup: GPUBindGroup,
    layout: GPUBindGroupLayout,
    materialData: MaterialData,
    decodedMaterial: DecodedMaterialFlags,
    materialHash: number
}

export const enum SelectiveResource {
    BASE_COLOR_TEXTURE = 1 << 0,
    EMISSIVE_TEXTURE = 1 << 1,
    OCCLUSION_TEXTURE = 1 << 2,
    NORMAL_TEXTURE = 1 << 3,
    METALLIC_ROUGHNESS_TEXTURE = 1 << 4,
    TRANSMISSION_TEXTURE = 1 << 5,
    GLOSSINESS_TEXTURE = 1 << 6,
    SPECULAR_TEXTURE = 1 << 7,
    ALPHA = 1 << 8,
    UNLIT = 1 << 9,
    NORMAL = 1 << 10,
    UV = 1 << 11,
    DOUBLE_SIDED = 1 << 12,
    GLOSSINESS_SPECULAR_TEXTURE = 1 << 13,
    SPECULAR_FO_TEXTURE = 1 << 14,
    CLEARCOAT_TEXTURE = 1 << 15,
    CLEARCOAT_ROUGHNESS_TEXTURE = 1 << 16,
    CLEARCOAT__NORMAL_TEXTURE = 1 << 17,
}

export const enum GeometryLayout {
    NORMAL = 1 << 1,
}

export type ShaderFlag =
    PipelineFlags.BASE
    | PipelineFlags.EMISSIVE
    | PipelineFlags.OCCLUSION
    | PipelineFlags.NORMAL
    | PipelineFlags.METALLIC
    | PipelineFlags.ROUGHNESS
    | PipelineFlags.TRANSMISSION
    | PipelineFlags.GLOSSINESS
    | PipelineFlags.SPECULAR
    | PipelineFlags.OPACITY
    | PipelineFlags.GLOSSINESS_SPECULAR
    | PipelineFlags.SPECULAR_FO
    | PipelineFlags.CLEARCOAT
    | PipelineFlags.CLEARCOAT_ROUGHNESS
    | PipelineFlags.CLEARCOAT__NORMAL
