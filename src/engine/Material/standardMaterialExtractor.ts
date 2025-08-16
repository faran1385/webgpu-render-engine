import {MaterialInstance} from "./Material.ts";
import {Material, Texture, TextureInfo} from "@gltf-transform/core";
import {BaseLayer} from "../../layers/baseLayer.ts";
import {createGPUBuffer} from "../../helpers/global.helper.ts";
import {GPUCache} from "../GPURenderSystem/GPUCache/GPUCache.ts";
import {StandardMaterial, standardMaterialTextureInfo} from "./StandardMaterial.ts";
import {
    Anisotropy,
    Clearcoat, DiffuseTransmission,
    Dispersion,
    IOR,
    Iridescence,
    Sheen,
    Specular,
    Transmission,
    Volume
} from "@gltf-transform/extensions";


export class StandardMaterialExtractor {
    private materialSamplers = new Map<string, {
        sampler: GPUSampler,
        textures: string[]
    }>()

    private pushEntriesDescriptor(
        getTexture: (() => Texture | null) | undefined,
        materialFactorsArray: number[],
        factors: number[],
        inUseTexCoords: Set<number>,
        getTextureInfo: (() => TextureInfo | null) | undefined,
        material: Material,
        fragmentOverride: string,
        materialInstance: MaterialInstance,
        textureInfoKey: keyof standardMaterialTextureInfo,
        makeSingleTexture: boolean = false
    ) {
        const texture = getTexture?.call(material);
        materialFactorsArray.push(...factors)
        materialInstance.shaderDescriptor.overrides[fragmentOverride] = false;
        if (texture) {
            const size = texture.getSize() ?? [64, 64]
            const data = texture.getImage()!;
            materialInstance.textureInfo[textureInfoKey].dimension = size;
            if (makeSingleTexture) {
                materialInstance.textureInfo[textureInfoKey].hash = BaseLayer.hasher.hashTexture(data)
                materialInstance.descriptor.bindGroupEntries.push({
                    bindingPoint: materialInstance.bindingCounter,
                    additional: {
                        typedArray: {
                            convertType: "texture",
                            size: {
                                width: size[0],
                                height: size[1]
                            },
                            format: "rgba8unorm-srgb",
                            data
                        }
                    }
                })
                materialInstance.descriptor.layoutEntries.push({
                    binding: materialInstance.bindingCounter,
                    texture: {
                        sampleType: "float"
                    },
                    visibility: GPUShaderStage.FRAGMENT
                })
                materialInstance.shaderDescriptor.bindings.push({
                    binding: materialInstance.bindingCounter,
                    group: 1,
                    wgslType: "texture_2d<f32>",
                    name: "baseColorTexture",
                    address: "var"
                })
                materialInstance.bindingCounter++
            } else {
                BaseLayer.hasher.setTextureHashGraph({
                    material: materialInstance,
                    textureKey: textureInfoKey,
                    data,
                    dimensions: size,
                });
            }
            const samplerData = getTextureInfo ? GPUCache.textureGenerator.createSamplerCaller(getTextureInfo.call(material)) : {
                name: 'SAMPLER_DEFAULT',
                sampler: BaseLayer.samplers.default
            }

            if (this.materialSamplers.has(samplerData.name)) {
                this.materialSamplers.get(samplerData.name)?.textures.push(textureInfoKey)
            } else {
                this.materialSamplers.set(samplerData.name, {
                    sampler: samplerData.sampler,
                    textures: [textureInfoKey]
                })
            }

            materialInstance.shaderDescriptor.overrides[fragmentOverride] = true;
            inUseTexCoords.add(getTextureInfo?.call(material)?.getTexCoord() ?? 0)
        }
    }

    extractTextures(materialInstance: StandardMaterial, material: Material) {
        const materialFactorsArray: number[] = []
        const inUseTexCoords = new Set<number>();

        // base color
        this.pushEntriesDescriptor(
            material.getBaseColorTexture,
            materialFactorsArray,
            material.getBaseColorFactor().flat(),
            inUseTexCoords,
            material.getBaseColorTextureInfo, material,
            "HAS_BASE_COLOR_MAP", materialInstance,
            "albedo",
            true
        )

        // metallic roughness
        this.pushEntriesDescriptor(
            material.getMetallicRoughnessTexture,
            materialFactorsArray,
            [material.getMetallicFactor(), material.getRoughnessFactor()],
            inUseTexCoords,
            material.getMetallicRoughnessTextureInfo, material,
            "HAS_METALLIC_ROUGHNESS_MAP", materialInstance,
            "metallic_roughness"
        )

        // normal
        this.pushEntriesDescriptor(
            material.getNormalTexture,
            materialFactorsArray,
            [material.getNormalScale()],
            inUseTexCoords,
            material.getNormalTextureInfo, material,
            "HAS_NORMAL_MAP", materialInstance,
            "normal"
        )

        // ao
        this.pushEntriesDescriptor(
            material.getOcclusionTexture,
            materialFactorsArray,
            [material.getOcclusionStrength()],
            inUseTexCoords,
            material.getOcclusionTextureInfo, material,
            "HAS_AO_MAP", materialInstance,
            "ambient_occlusion"
        )
        console.log(materialInstance.shaderDescriptor.overrides)
        // emissive
        this.pushEntriesDescriptor(
            material.getEmissiveTexture,
            materialFactorsArray,
            [...material.getEmissiveFactor()],
            inUseTexCoords,
            material.getEmissiveTextureInfo, material,
            "HAS_EMISSIVE_MAP", materialInstance,
            "emissive"
        )
        materialFactorsArray.push(material.getAlphaCutoff())

        /////////// extensions
        // ior
        const iorExtension = material.getExtension<IOR>('KHR_materials_ior');
        materialInstance.shaderDescriptor.overrides.HAS_IOR = false
        if (iorExtension) {
            materialFactorsArray.push(iorExtension.getIOR())
            materialInstance.shaderDescriptor.overrides.HAS_IOR = true
        } else {
            materialFactorsArray.push(1.5)
        }
        // sheen
        const sheenExtension = material.getExtension<Sheen>('KHR_materials_sheen');
        materialInstance.shaderDescriptor.overrides.HAS_SHEEN = Boolean(sheenExtension)
        // sheen color
        this.pushEntriesDescriptor(
            sheenExtension?.getSheenColorTexture,
            materialFactorsArray,
            [0, 0, 0, ...sheenExtension?.getSheenColorFactor() ?? [1, 1, 1]],
            inUseTexCoords,
            sheenExtension?.getSheenColorTextureInfo, material,
            "HAS_SHEEN_COLOR_MAP", materialInstance,
            "sheen_color"
        )
        // sheen roughness
        this.pushEntriesDescriptor(
            sheenExtension?.getSheenRoughnessTexture,
            materialFactorsArray,
            [sheenExtension?.getSheenRoughnessFactor() ?? 1],
            inUseTexCoords,
            sheenExtension?.getSheenRoughnessTextureInfo, material,
            "HAS_SHEEN_ROUGHNESS_MAP", materialInstance,
            "sheen_roughness"
        )

        ///// clearcoat
        // clearcoat
        const clearcoatExtension = material.getExtension<Clearcoat>("KHR_materials_clearcoat");
        materialInstance.shaderDescriptor.overrides.HAS_CLEARCOAT = Boolean(clearcoatExtension)

        this.pushEntriesDescriptor(
            clearcoatExtension?.getClearcoatTexture,
            materialFactorsArray,
            [clearcoatExtension?.getClearcoatFactor() ?? 0],
            inUseTexCoords,
            clearcoatExtension?.getClearcoatTextureInfo, material,
            "HAS_CLEARCOAT_MAP", materialInstance,
            "clearcoat"
        )

        // clearcoat normal
        this.pushEntriesDescriptor(
            clearcoatExtension?.getClearcoatNormalTexture,
            materialFactorsArray,
            [clearcoatExtension?.getClearcoatNormalScale() ?? 0],
            inUseTexCoords,
            clearcoatExtension?.getClearcoatTextureInfo, material,
            "HAS_CLEARCOAT_NORMAL_MAP", materialInstance,
            "clearcoat_normal"
        )

        // clearcoat roughness
        this.pushEntriesDescriptor(
            clearcoatExtension?.getClearcoatRoughnessTexture,
            materialFactorsArray,
            [clearcoatExtension?.getClearcoatRoughnessFactor() ?? 1],
            inUseTexCoords,
            clearcoatExtension?.getClearcoatRoughnessTextureInfo, material,
            "HAS_CLEARCOAT_ROUGHNESS_MAP", materialInstance,
            "clearcoat_roughness"
        )

        ///// specular
        const specularExtension = material.getExtension<Specular>("KHR_materials_specular");
        materialInstance.shaderDescriptor.overrides.HAS_SPECULAR = Boolean(clearcoatExtension)
        // specular
        this.pushEntriesDescriptor(
            specularExtension?.getSpecularTexture,
            materialFactorsArray,
            [specularExtension?.getSpecularFactor() ?? 0],
            inUseTexCoords,
            specularExtension?.getSpecularTextureInfo, material,
            "HAS_SPECULAR_MAP", materialInstance,
            "specular"
        )
        // specular color
        this.pushEntriesDescriptor(
            specularExtension?.getSpecularColorTexture,
            materialFactorsArray,
            specularExtension?.getSpecularColorFactor().flat() ?? [0, 0, 0],
            inUseTexCoords,
            specularExtension?.getSpecularTextureInfo, material,
            "HAS_SPECULAR_COLOR_MAP", materialInstance,
            "specular_color"
        )
        ///// transmission
        const transmissionExtension = material.getExtension<Transmission>("KHR_materials_transmission");
        materialInstance.shaderDescriptor.overrides.HAS_TRANSMISSION = Boolean(transmissionExtension)
        // transmission
        this.pushEntriesDescriptor(
            transmissionExtension?.getTransmissionTexture,
            materialFactorsArray,
            [transmissionExtension?.getTransmissionFactor() ?? 0],
            inUseTexCoords,
            transmissionExtension?.getTransmissionTextureInfo, material,
            "HAS_TRANSMISSION_MAP", materialInstance,
            "transmission"
        )
        //dispersion
        const dispersionExtension = material.getExtension<Dispersion>("KHR_materials_dispersion");
        materialInstance.shaderDescriptor.overrides.HAS_DISPERSION = Boolean(dispersionExtension)
        const dispersion = dispersionExtension?.getDispersion()
        materialFactorsArray.push(dispersion ?? 0)
        //////////// volume
        const volumeExtension = material.getExtension<Volume>("KHR_materials_volume");
        materialInstance.shaderDescriptor.overrides.HAS_VOLUME = Boolean(volumeExtension)
        // thickness
        this.pushEntriesDescriptor(
            volumeExtension?.getThicknessTexture,
            materialFactorsArray,
            [volumeExtension?.getThicknessFactor() ?? 0],
            inUseTexCoords,
            volumeExtension?.getThicknessTextureInfo, material,
            "HAS_THICKNESS_MAP", materialInstance,
            "thickness"
        )
        // attenuationDistance
        materialFactorsArray.push(volumeExtension?.getAttenuationDistance() ?? 1, 0);
        // attenuationColor
        materialFactorsArray.push(...volumeExtension?.getAttenuationColor() ?? [0, 1, 0]);
        /////// iridescence
        const iridescenceExtension = material.getExtension<Iridescence>("KHR_materials_iridescence");
        materialInstance.shaderDescriptor.overrides.HAS_IRIDESCENCE = Boolean(iridescenceExtension)
        // iridescence
        this.pushEntriesDescriptor(
            iridescenceExtension?.getIridescenceTexture,
            materialFactorsArray,
            [iridescenceExtension?.getIridescenceFactor() ?? 0.9],
            inUseTexCoords,
            iridescenceExtension?.getIridescenceTextureInfo, material,
            "HAS_IRIDESCENCE_MAP", materialInstance,
            "iridescence"
        )

        // iridescence thickness
        materialFactorsArray.push(iridescenceExtension?.getIridescenceThicknessMinimum() ?? 0)
        materialFactorsArray.push(iridescenceExtension?.getIridescenceThicknessMaximum() ?? 1)
        materialFactorsArray.push(iridescenceExtension?.getIridescenceIOR() ?? 0)

        this.pushEntriesDescriptor(
            iridescenceExtension?.getIridescenceThicknessTexture,
            materialFactorsArray,
            [],
            inUseTexCoords,
            iridescenceExtension?.getIridescenceThicknessTextureInfo, material,
            "HAS_IRIDESCENCE_THICKNESS_MAP", materialInstance,
            "iridescence_thickness"
        )
        //////// diffuse transmission
        const diffuseTransmissionExtension = material.getExtension<DiffuseTransmission>("KHR_materials_diffuse_transmission");
        materialInstance.shaderDescriptor.overrides.HAS_DIFFUSE_TRANSMISSION = Boolean(diffuseTransmissionExtension)
        // diffuse transmission
        this.pushEntriesDescriptor(
            diffuseTransmissionExtension?.getDiffuseTransmissionTexture,
            materialFactorsArray,
            [diffuseTransmissionExtension?.getDiffuseTransmissionFactor() ?? 0],
            inUseTexCoords,
            diffuseTransmissionExtension?.getDiffuseTransmissionTextureInfo, material,
            "HAS_DIFFUSE_TRANSMISSION_MAP", materialInstance,
            "diffuse_transmission"
        )

        // diffuse transmission color
        this.pushEntriesDescriptor(
            diffuseTransmissionExtension?.getDiffuseTransmissionColorTexture,
            materialFactorsArray,
            diffuseTransmissionExtension?.getDiffuseTransmissionColorFactor() ?? [0, 0, 0],
            inUseTexCoords,
            diffuseTransmissionExtension?.getDiffuseTransmissionTextureInfo, material,
            "HAS_DIFFUSE_TRANSMISSION_COLOR_MAP", materialInstance,
            "diffuse_transmission_color"
        )

        // ////// anisotropy
        const anisotropyExtension = material.getExtension<Anisotropy>("KHR_materials_anisotropy");
        materialInstance.shaderDescriptor.overrides.HAS_ANISOTROPY = Boolean(anisotropyExtension)
        materialFactorsArray.push(...[0,
            Math.cos(anisotropyExtension?.getAnisotropyRotation() ?? 0),
            Math.sin(anisotropyExtension?.getAnisotropyRotation() ?? 0),
            anisotropyExtension?.getAnisotropyStrength() ?? 1
        ])

        // anisotropy
        this.pushEntriesDescriptor(
            anisotropyExtension?.getAnisotropyTexture,
            materialFactorsArray,
            [],
            inUseTexCoords,
            anisotropyExtension?.getAnisotropyTextureInfo, material,
            "HAS_ANISOTROPY_MAP", materialInstance,
            "anisotropy"
        )

        // environment
        // intensity
        materialFactorsArray.push(1);
        // rotation
        materialFactorsArray.push(...[
            1,0,0,0,
            0,1,0,0,
            0,0,1,0,
        ]);

        const materialFactorsBuffer = createGPUBuffer(
            BaseLayer.device, new Float32Array(materialFactorsArray),
            GPUBufferUsage.UNIFORM, `${materialInstance.name} material info buffer`, 240
        )

        // pushing entries
        // materialFactors
        materialInstance.descriptor.bindGroupEntries.push({
            bindingPoint: materialInstance.bindingCounter,
            buffer: materialFactorsBuffer,
        })
        materialInstance.descriptor.layoutEntries.push({
            binding: materialInstance.bindingCounter,
            buffer: {
                type: "uniform"
            },
            visibility: GPUShaderStage.FRAGMENT
        })
        materialInstance.shaderDescriptor.bindings.push({
            name: 'materialFactors',
            wgslType: 'MaterialFactors',
            address: 'var<uniform>',
            binding: materialInstance.bindingCounter,
            group: 1
        })
        materialInstance.bindingCounter++

        // sampler
        this.materialSamplers.forEach(({sampler, textures}, name) => {
            materialInstance.descriptor.bindGroupEntries.push({
                bindingPoint: materialInstance.bindingCounter,
                sampler
            })
            materialInstance.descriptor.layoutEntries.push({
                binding: materialInstance.bindingCounter,
                sampler: {
                    type: "filtering"
                },
                visibility: GPUShaderStage.FRAGMENT
            })
            materialInstance.shaderDescriptor.bindings.push({
                name,
                wgslType: 'sampler',
                address: 'var',
                binding: materialInstance.bindingCounter,
                group: 1
            })
            textures.forEach(texture => {
                materialInstance.shaderDescriptor.compileHints.push({
                    searchKeyword: `${texture}.sampler`,
                    replaceKeyword: name
                })
            })
            materialInstance.bindingCounter++
        })
    }

    extractMaterial(materialInstance: StandardMaterial, material: Material) {
        this.extractTextures(materialInstance, material)
        const alphaMode = material.getAlphaMode();

        materialInstance.shaderDescriptor.overrides.ALPHA_MODE = alphaMode === "OPAQUE" ? 0 : alphaMode === "BLEND" ? 1 : 2
        materialInstance.alpha = {
            mode: alphaMode,
            cutoff: material.getAlphaCutoff()
        }
        materialInstance.isDoubleSided = material.getDoubleSided()
        materialInstance.isTransparent = alphaMode === "BLEND"
    }
}