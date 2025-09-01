import {Material as MaterialClass} from "./Material.ts";
import {Material} from "@gltf-transform/core";
import {StandardMaterialExtractor} from "./standardMaterialExtractor.ts";
import {BaseBindGroupEntryCreationType} from "../GPURenderSystem/GPUCache/GPUCacheTypes.ts";


export type matTextureInfo = {
    hash: number | null,
    samplerKey: string,
    dimension: [number, number] | null,
    shareInfo: {
        arrayIndex: number,
        dimension: string,
    } | null,
    override: string
}
export type standardMaterialTextureInfo = {
    albedo: matTextureInfo,
    emissive: matTextureInfo,
    ambient_occlusion: matTextureInfo,
    metallic_roughness: matTextureInfo,
    normal: matTextureInfo,
    sheen_color: matTextureInfo,
    sheen_roughness: matTextureInfo,
    clearcoat: matTextureInfo,
    clearcoat_normal: matTextureInfo,
    clearcoat_roughness: matTextureInfo,
    transmission: matTextureInfo,
    specular: matTextureInfo,
    specular_color: matTextureInfo,
    thickness: matTextureInfo,
    iridescence: matTextureInfo,
    iridescence_thickness: matTextureInfo,
    diffuse_transmission: matTextureInfo,
    diffuse_transmission_color: matTextureInfo,
    anisotropy: matTextureInfo,
    specular_glossiness: matTextureInfo,
    specular_glossiness_diffuse: matTextureInfo,
}

export class StandardMaterial extends MaterialClass {

    descriptor: {
        bindGroupEntries: BaseBindGroupEntryCreationType[],
        layoutEntries: GPUBindGroupLayoutEntry[]
    } = {bindGroupEntries: [], layoutEntries: []}

    materialFactors!: GPUBuffer;
    updateAbleTexture = new Map<keyof standardMaterialTextureInfo, {
        hash: number,
        width: number,
        height: number,
    }>();
    textureInfo: standardMaterialTextureInfo = {
        albedo: {override: "HAS_BASE_COLOR_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        emissive: {override: "HAS_EMISSIVE_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        ambient_occlusion: {override: "HAS_AO_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        metallic_roughness: {override: "HAS_METALLIC_ROUGHNESS_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        normal: {override: "HAS_NORMAL_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        clearcoat_roughness: {override: "HAS_CLEARCOAT_ROUGHNESS_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        clearcoat_normal: {override: "HAS_CLEARCOAT_NORMAL_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        clearcoat: {override: "HAS_CLEARCOAT_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        sheen_roughness: {override: "HAS_SHEEN_ROUGHNESS_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        sheen_color: {override: "HAS_SHEEN_COLOR_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        specular: {override: "HAS_SPECULAR_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        specular_color: {override: "HAS_SPECULAR_COLOR_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        thickness: {override: "HAS_THICKNESS_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        transmission: {override: "HAS_TRANSMISSION_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        iridescence: {override: "HAS_IRIDESCENCE_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        iridescence_thickness: {override: "HAS_IRIDESCENCE_THICKNESS_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        diffuse_transmission: {override: "HAS_DIFFUSE_TRANSMISSION_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        diffuse_transmission_color: {override: "HAS_DIFFUSE_TRANSMISSION_COLOR_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        anisotropy: {override: "HAS_ANISOTROPY_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        specular_glossiness: {override: "HAS_SPECULAR_GLOSSINESS_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
        specular_glossiness_diffuse: {override: "HAS_SPECULAR_GLOSSINESS_DIFFUSE_MAP",hash: null, samplerKey: "SAMPLER_DEFAULT", dimension: null, shareInfo: null},
    }

    setMaterialFactors(buffer: GPUBuffer) {
        this.materialFactors = buffer
    }

    init(material: Material | null) {
        this.name = material?.getName() ?? "Default"

        if (material) {
            new StandardMaterialExtractor().extractMaterial(this, material)
        } else {
            new StandardMaterialExtractor().setDescForNullMats(this)
        }
    }
}