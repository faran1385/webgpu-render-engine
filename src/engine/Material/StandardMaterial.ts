import {Material as MaterialClass} from "./Material.ts";
import {Material} from "@gltf-transform/core";
import {StandardMaterialExtractor} from "./standardMaterialExtractor.ts";
import {BaseBindGroupEntryCreationType} from "../GPURenderSystem/GPUCache/GPUCacheTypes.ts";
import {BaseLayer} from "../../layers/baseLayer.ts";


export type matTextureInfo = {
    hash: number | null,
    dimension: [number, number] | null,
    shareInfo: {
        arrayIndex: number,
        dimension: string,
    } | null,
    textureReference: GPUTexture | null
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
}

export class StandardMaterial extends MaterialClass {
    descriptor: {
        bindGroupEntries: BaseBindGroupEntryCreationType[],
        layoutEntries: GPUBindGroupLayoutEntry[]
    } = {bindGroupEntries: [], layoutEntries: []}

    private materialFactors!: GPUBuffer;

    textureInfo: standardMaterialTextureInfo = {
        albedo: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        emissive: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        ambient_occlusion: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        metallic_roughness: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        normal: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        clearcoat_roughness: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        clearcoat_normal: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        clearcoat: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        sheen_roughness: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        sheen_color: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        specular: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        specular_color: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        thickness: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        transmission: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        iridescence: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        iridescence_thickness: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        diffuse_transmission: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        diffuse_transmission_color: {hash: null, dimension: null, shareInfo: null, textureReference: null},
        anisotropy: {hash: null, dimension: null, shareInfo: null, textureReference: null},
    }

    setMaterialFactors(buffer: GPUBuffer) {
        this.materialFactors = buffer
    }


    setMetallic(metallic: number) {
        BaseLayer.device.queue.writeBuffer(this.materialFactors, 16, new Float32Array([metallic]));
    }

    setRoughness(roughness: number) {
        BaseLayer.device.queue.writeBuffer(this.materialFactors, 20, new Float32Array([roughness]));
    }

    setIOR(ior: number) {
        BaseLayer.device.queue.writeBuffer(this.materialFactors, 48, new Float32Array([ior]));
    }
    setClearcoatIOR(ior: number) {
        BaseLayer.device.queue.writeBuffer(this.materialFactors, 52, new Float32Array([ior]));
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