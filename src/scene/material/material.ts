import {MaterialData, MaterialFlags, SelectiveResource} from "../loader/loaderTypes.ts";
import {Extension, Material as GLTFMaterial, Texture, vec2} from "@gltf-transform/core";
import {
    Clearcoat,
    EmissiveStrength,
    PBRSpecularGlossiness,
    Specular,
    Transmission,
    Unlit
} from "@gltf-transform/extensions";
import {MaterialManager} from "./materialManager.ts";

export class Material extends MaterialManager {
    private materialPointer: GLTFMaterial;
    private materialData: MaterialData = {
        alpha: {
            mode: 'OPAQUE',
            value: 0,
            cutoffAlpha: 0
        },
        clearcoat: {
            texture: null,
            normalTexture: null,
            roughnessTexture: null,
            normalScale: 0,
            factor: 0,
            roughnessFactor: 0
        },
        emissive: {texture: null, factor: [0, 0, 0]},
        glossinessSpecular: {texture: null, factor: [0, 0, 0]},
        specularColor: {texture: null, factor: [0, 0, 0]},
        base: {texture: null, factor: [0, 0, 0, 1]},
        occlusion: {texture: null, strength: 0},
        normal: {texture: null, scale: 0},
        metallicRoughness: {texture: null, factor: [0, 0]},
        transmission: null,
        glossiness: null,
        emissiveStrength: null,
        specular: null,
        unlit: false,
        doubleSided: false
    };
    private extensions: Extension[] = [];
    private bindGroupHash!: number;
    private selectiveResource: "ALL" | SelectiveResource[] = 'ALL';

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext, mat: GLTFMaterial, extensions: Extension[], selectiveResource: SelectiveResource[] | undefined = undefined) {
        super(device, canvas, ctx);
        this.materialPointer = mat;
        this.extensions = extensions;
        this.selectiveResource = selectiveResource ?? 'ALL'
    }

    private extractMaterial() {
        this.materialData.base = {
            texture: this.materialPointer.getBaseColorTexture() ? {
                array: (this.materialPointer.getBaseColorTexture() as Texture).getImage(),
                size: (this.materialPointer.getBaseColorTexture() as Texture).getSize() as vec2,
            } : null,
            factor: this.materialPointer.getBaseColorFactor()
        }
        this.materialData.normal = {
            texture: this.materialPointer.getNormalTexture() ? {
                array: (this.materialPointer.getNormalTexture() as Texture).getImage(),
                size: (this.materialPointer.getNormalTexture() as Texture).getSize() as vec2,
            } : null,
            scale: this.materialPointer.getNormalScale()
        }
        this.materialData.occlusion = {
            texture: this.materialPointer.getOcclusionTexture() ? {
                array: (this.materialPointer.getOcclusionTexture() as Texture).getImage(),
                size: (this.materialPointer.getOcclusionTexture() as Texture).getSize() as vec2,
            } : null,
            strength: this.materialPointer.getOcclusionStrength()
        }
        this.materialData.emissive = {
            texture: this.materialPointer.getEmissiveTexture() ? {
                array: (this.materialPointer.getEmissiveTexture() as Texture).getImage(),
                size: (this.materialPointer.getEmissiveTexture() as Texture).getSize() as vec2,
            } : null,
            factor: this.materialPointer.getEmissiveFactor()
        }
        this.materialData.metallicRoughness = {
            texture: this.materialPointer.getMetallicRoughnessTexture() ? {
                array: (this.materialPointer.getMetallicRoughnessTexture() as Texture).getImage(),
                size: (this.materialPointer.getMetallicRoughnessTexture() as Texture).getSize() as vec2,
            } : null,
            factor: [
                this.materialPointer.getMetallicFactor?.() ?? 1.0,
                this.materialPointer.getRoughnessFactor?.() ?? 1.0
            ]
        }
        this.materialData.alpha = {
            cutoffAlpha: this.materialPointer.getAlphaCutoff(),
            value: this.materialPointer.getAlpha(),
            mode: this.materialPointer.getAlphaMode(),
        }
        this.materialData.doubleSided = this.materialPointer.getDoubleSided()
    }

    private extractMaterialExtensions() {
        this.extensions.forEach((extension) => {
            if (extension.extensionName === "KHR_materials_transmission") {
                const transmission = this.materialPointer.getExtension<Transmission>(extension.extensionName);
                if (transmission) {
                    const texture = transmission.getTransmissionTexture();
                    this.materialData.transmission = {
                        texture: texture ? {
                            array: texture.getImage(),
                            size: texture.getSize() as vec2
                        } : null,
                        factor: transmission.getTransmissionFactor(),
                    }
                }
            }
            if (extension.extensionName === "KHR_materials_pbrSpecularGlossiness") {
                const sg = this.materialPointer.getExtension<PBRSpecularGlossiness>(extension.extensionName);
                if (sg) {
                    const specTex = sg.getSpecularGlossinessTexture();
                    this.materialData.glossinessSpecular = {
                        texture: specTex ? {
                            array: specTex.getImage() as Uint8Array,
                            size: specTex.getSize() as vec2,
                        } : null,
                        factor: sg.getSpecularFactor(),
                    };

                    this.materialData.glossiness = {
                        texture: specTex ? {
                            array: specTex.getImage() as Uint8Array,
                            size: specTex.getSize() as vec2,
                        } : null,
                        factor: sg.getGlossinessFactor(),
                    };
                }
            }

            if (extension.extensionName === "KHR_materials_emissive_strength") {
                const emissiveStrengthExtension = this.materialPointer.getExtension<EmissiveStrength>(extension.extensionName);
                if (emissiveStrengthExtension) {
                    this.materialData.emissiveStrength = emissiveStrengthExtension.getEmissiveStrength();
                }
            }
            if (extension.extensionName === "KHR_materials_specular") {
                const specular = this.materialPointer.getExtension<Specular>(extension.extensionName);
                if (specular) {
                    const texture = specular.getSpecularTexture();
                    const specularColorTexture = specular.getSpecularColorTexture();
                    this.materialData.specular = {
                        texture: texture ? {
                            array: texture.getImage(),
                            size: texture.getSize() as vec2
                        } : null,
                        factor: specular.getSpecularFactor(),
                    }
                    this.materialData.specularColor = {
                        texture: specularColorTexture ? {
                            array: specularColorTexture.getImage(),
                            size: specularColorTexture.getSize() as vec2
                        } : null,
                        factor: specular.getSpecularColorFactor(),
                    }
                }
            }
            if (extension.extensionName === "KHR_materials_clearcoat") {
                const clearcoat = this.materialPointer.getExtension<Clearcoat>(extension.extensionName);
                if (clearcoat) {
                    const clearcoatTexture = clearcoat.getClearcoatTexture();
                    const clearcoatRoughnessTexture = clearcoat.getClearcoatRoughnessTexture();
                    const clearcoatNormalTexture = clearcoat.getClearcoatNormalTexture();
                    this.materialData.clearcoat = {
                        texture: clearcoatTexture ? {
                            array: clearcoatTexture.getImage(),
                            size: clearcoatTexture.getSize() as vec2
                        } : null,
                        factor: clearcoat.getClearcoatFactor(),
                        roughnessTexture: clearcoatRoughnessTexture ? {
                            array: clearcoatRoughnessTexture.getImage(),
                            size: clearcoatRoughnessTexture.getSize() as vec2
                        } : null,
                        roughnessFactor: clearcoat.getClearcoatRoughnessFactor(),
                        normalTexture: clearcoatNormalTexture ? {
                            array: clearcoatNormalTexture.getImage(),
                            size: clearcoatNormalTexture.getSize() as vec2
                        } : null,
                        normalScale: clearcoat.getClearcoatNormalScale(),
                    }
                }
            }

            if (extension.extensionName === "KHR_materials_unlit") {
                this.materialData.unlit = Boolean(this.materialPointer.getExtension<Unlit>(extension.extensionName))
            }
        })
    }

    private hashMaterialFeatures() {
        let hash = 0;
        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.BASE_COLOR_TEXTURE)) && this.materialData.base.texture?.array) {
            hash |= MaterialFlags.HasBaseColorTexture;
        }
        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.EMISSIVE_TEXTURE)) && this.materialData.emissive.texture?.array) {
            hash |= MaterialFlags.HasEmissiveTexture;
        }
        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.OCCLUSION_TEXTURE)) && this.materialData.occlusion.texture?.array) {
            hash |= MaterialFlags.HasOcclusionTexture;
        }
        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.NORMAL_TEXTURE)) && this.materialData.normal.texture?.array) {
            hash |= MaterialFlags.HasNormalTexture;
        }

        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.METALLIC_ROUGHNESS_TEXTURE)) && this.materialData.metallicRoughness.texture?.array) {
            hash |= MaterialFlags.HasMetallicRoughnessTex;
        }
        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.TRANSMISSION_TEXTURE)) && this.materialData.transmission?.texture?.array) {
            hash |= MaterialFlags.HasTransmissionTexture;
        }
        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.GLOSSINESS_TEXTURE)) && this.materialData.glossiness?.texture?.array) {
            hash |= MaterialFlags.HasGlossinessTexture;
        }
        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.SPECULAR_TEXTURE)) && this.materialData.specular?.texture?.array) {
            hash |= MaterialFlags.HasSpecularTexture;
        }
        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.SPECULAR_COLOR_TEXTURE)) && this.materialData.specularColor?.texture?.array) {
            hash |= MaterialFlags.HasSpecularColorTexture;
        }
        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.GLOSSINESS_SPECULAR_TEXTURE)) && this.materialData.glossinessSpecular?.texture?.array) {
            hash |= MaterialFlags.HasGlossinessSpecularTexture;
        }
        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.CLEARCOAT_TEXTURE)) && this.materialData.clearcoat?.texture?.array) {
            hash |= MaterialFlags.HasClearcoatTexture;
        }
        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.CLEARCOAT_ROUGHNESS_TEXTURE)) && this.materialData.clearcoat?.roughnessTexture?.array) {
            hash |= MaterialFlags.HasClearcoatRoughnessTexture;
        }
        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.CLEARCOAT__NORMAL_TEXTURE)) && this.materialData.clearcoat?.normalTexture?.array) {
            hash |= MaterialFlags.HasClearcoatNormalTexture;
        }

        if (this.materialData.alpha.mode === 'OPAQUE') {
            hash |= MaterialFlags.AlphaMode_Opaque;
        } else if (this.materialData.alpha.mode === 'MASK') {
            hash |= MaterialFlags.AlphaMode_MaskOnly;
        } else if (this.materialData.alpha.mode === 'BLEND') {
            hash |= MaterialFlags.AlphaMode_Blend;
        }


        if ((this.selectiveResource === "ALL" || this.selectiveResource.includes(SelectiveResource.UNLIT)) && this.materialData.unlit) {
            hash |= MaterialFlags.IsUnlit;
        }
        this.bindGroupHash = hash;
    }


    public async init() {
        this.extractMaterial()
        this.extractMaterialExtensions()
        this.hashMaterialFeatures()
        MaterialManager.appendPipelineResourceHash = this.bindGroupHash
        return {
            ...await MaterialManager.getRenderSetup(this.bindGroupHash, this.materialData),
            materialData: this.materialData,
            materialHash: this.bindGroupHash
        };
    }
}