import {MaterialInstance} from "./Material.ts";
import {Material, Texture, TextureInfo} from "@gltf-transform/core";
import {BaseLayer} from "../../layers/baseLayer.ts";
import {createGPUBuffer} from "../../helpers/global.helper.ts";
import {GPUCache} from "../GPURenderSystem/GPUCache/GPUCache.ts";
import {StandardMaterial, standardMaterialTextureInfo} from "./StandardMaterial.ts";
import {
    Anisotropy,
    Clearcoat, DiffuseTransmission,
    Dispersion, EmissiveStrength,
    IOR,
    Iridescence, PBRSpecularGlossiness,
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
    private isUnlit: boolean = false;
    private hasSpecularGlossiness: boolean = false;

    private pushEntriesDescriptor(
        getTexture: {
            func: (() => Texture | null) | undefined,
            callBY: any
        },
        materialFactorsArray: number[],
        factors: number[],
        inUseTexCoords: Set<number>,
        getTextureInfo: {
            func: (() => TextureInfo | null) | undefined,
            callBY: any
        },
        fragmentOverride: string,
        materialInstance: MaterialInstance,
        textureInfoKey: keyof standardMaterialTextureInfo,
        makeSingleTexture: boolean = false
    ) {
        const texture = getTexture.func?.call(getTexture.callBY);
        materialFactorsArray.push(...factors)
        materialInstance.shaderDescriptor.overrides[fragmentOverride] = false;
        if (texture && (!this.isUnlit || (textureInfoKey === "albedo" || textureInfoKey === "emissive")) && (!this.hasSpecularGlossiness || textureInfoKey === "emissive" || textureInfoKey === "ambient_occlusion")) {
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
            const samplerData = getTextureInfo ? GPUCache.textureGenerator.createSamplerCaller(getTextureInfo.func?.call(getTextureInfo.callBY) ?? null) : {
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
            inUseTexCoords.add(getTextureInfo.func?.call(getTextureInfo.callBY)?.getTexCoord() ?? 0)
        }
    }

    extractTextures(materialInstance: StandardMaterial, material: Material) {
        const materialFactorsArray: number[] = []
        const inUseTexCoords = new Set<number>();
        const specularGlossinessExtension = material.getExtension<PBRSpecularGlossiness>("KHR_materials_pbrSpecularGlossiness");

        this.isUnlit = Boolean(material.getExtension("KHR_materials_unlit"));
        this.hasSpecularGlossiness = Boolean(specularGlossinessExtension);

        materialInstance.shaderDescriptor.overrides.IS_UNLIT = this.isUnlit;
        materialInstance.shaderDescriptor.overrides.IS_SPECULAR_GLOSSINESS = this.hasSpecularGlossiness;
        // base color
        this.pushEntriesDescriptor(
            {func: material.getBaseColorTexture, callBY: material},
            materialFactorsArray,
            material.getBaseColorFactor().flat(),
            inUseTexCoords,
            {func: material.getBaseColorTextureInfo, callBY: material},
            "HAS_BASE_COLOR_MAP", materialInstance,
            "albedo",
            true
        )
        // metallic roughness
        this.pushEntriesDescriptor(
            {func: material.getMetallicRoughnessTexture, callBY: material},
            materialFactorsArray,
            [material.getMetallicFactor(), material.getRoughnessFactor()],
            inUseTexCoords,
            {func: material.getMetallicRoughnessTextureInfo, callBY: material},
            "HAS_METALLIC_ROUGHNESS_MAP", materialInstance,
            "metallic_roughness"
        )

        // normal
        this.pushEntriesDescriptor(
            {func: material.getNormalTexture, callBY: material},
            materialFactorsArray,
            [material.getNormalScale()],
            inUseTexCoords,
            {func: material.getNormalTextureInfo, callBY: material},
            "HAS_NORMAL_MAP", materialInstance,
            "normal"
        )

        // ao
        this.pushEntriesDescriptor(
            {func: material.getOcclusionTexture, callBY: material},
            materialFactorsArray,
            [material.getOcclusionStrength()],
            inUseTexCoords,
            {func: material.getOcclusionTextureInfo, callBY: material},
            "HAS_AO_MAP", materialInstance,
            "ambient_occlusion"
        )

        // emissive
        this.pushEntriesDescriptor(
            {func: material.getEmissiveTexture, callBY: material},
            materialFactorsArray,
            [...material.getEmissiveFactor()],
            inUseTexCoords,
            {func: material.getEmissiveTextureInfo, callBY: material},
            "HAS_EMISSIVE_MAP", materialInstance,
            "emissive"
        )

        materialFactorsArray.push(material.getAlphaCutoff())

        /////////// extensions
        // ior
        const iorExtension = material.getExtension<IOR>('KHR_materials_ior');
        materialInstance.shaderDescriptor.overrides.HAS_IOR = false
        if (iorExtension && !this.isUnlit && !this.hasSpecularGlossiness) {
            materialFactorsArray.push(iorExtension.getIOR())
            materialInstance.shaderDescriptor.overrides.HAS_IOR = true
        } else {
            materialFactorsArray.push(1.5)
        }

        materialFactorsArray.push(1.5) // clearcoat ior

        const emissiveStrengthExtension = material.getExtension<EmissiveStrength>('KHR_materials_emissive_strength');
        materialInstance.shaderDescriptor.overrides.HAS_EMISSIVE_STRENGTH = Boolean(emissiveStrengthExtension && !this.isUnlit && !this.hasSpecularGlossiness);
        materialFactorsArray.push(emissiveStrengthExtension?.getEmissiveStrength() ?? 1)


        // sheen
        const sheenExtension = material.getExtension<Sheen>('KHR_materials_sheen');
        materialInstance.shaderDescriptor.overrides.HAS_SHEEN = Boolean(sheenExtension && !this.isUnlit && !this.hasSpecularGlossiness)

        // sheen color
        this.pushEntriesDescriptor(
            {func: sheenExtension?.getSheenColorTexture, callBY: sheenExtension},
            materialFactorsArray,
            [0, ...sheenExtension?.getSheenColorFactor() ?? [1, 1, 1]],
            inUseTexCoords,
            {func: sheenExtension?.getSheenColorTextureInfo, callBY: sheenExtension},
            "HAS_SHEEN_COLOR_MAP", materialInstance,
            "sheen_color"
        )
        // sheen roughness
        this.pushEntriesDescriptor(
            {func: sheenExtension?.getSheenRoughnessTexture, callBY: sheenExtension},
            materialFactorsArray,
            [sheenExtension?.getSheenRoughnessFactor() ?? 1],
            inUseTexCoords,
            {func: sheenExtension?.getSheenRoughnessTextureInfo, callBY: sheenExtension},
            "HAS_SHEEN_ROUGHNESS_MAP", materialInstance,
            "sheen_roughness"
        )

        ///// clearcoat
        // clearcoat
        const clearcoatExtension = material.getExtension<Clearcoat>("KHR_materials_clearcoat");
        materialInstance.shaderDescriptor.overrides.HAS_CLEARCOAT = Boolean(clearcoatExtension && !this.isUnlit && !this.hasSpecularGlossiness)
        this.pushEntriesDescriptor(
            {func: clearcoatExtension?.getClearcoatTexture, callBY: clearcoatExtension},
            materialFactorsArray,
            [clearcoatExtension?.getClearcoatFactor() ?? 0],
            inUseTexCoords,
            {func: clearcoatExtension?.getClearcoatTextureInfo, callBY: clearcoatExtension},
            "HAS_CLEARCOAT_MAP", materialInstance,
            "clearcoat"
        )
        // clearcoat normal
        this.pushEntriesDescriptor(
            {func: clearcoatExtension?.getClearcoatNormalTexture, callBY: clearcoatExtension},
            materialFactorsArray,
            [clearcoatExtension?.getClearcoatNormalScale() ?? 0],
            inUseTexCoords,
            {func: clearcoatExtension?.getClearcoatTextureInfo, callBY: clearcoatExtension},
            "HAS_CLEARCOAT_NORMAL_MAP", materialInstance,
            "clearcoat_normal"
        )
        // clearcoat roughness
        this.pushEntriesDescriptor(
            {func: clearcoatExtension?.getClearcoatRoughnessTexture, callBY: clearcoatExtension},
            materialFactorsArray,
            [clearcoatExtension?.getClearcoatRoughnessFactor() ?? 1],
            inUseTexCoords,
            {func: clearcoatExtension?.getClearcoatRoughnessTextureInfo, callBY: clearcoatExtension},
            "HAS_CLEARCOAT_ROUGHNESS_MAP", materialInstance,
            "clearcoat_roughness"
        )

        ///// specular
        const specularExtension = material.getExtension<Specular>("KHR_materials_specular");
        materialInstance.shaderDescriptor.overrides.HAS_SPECULAR = Boolean(clearcoatExtension && !this.isUnlit && !this.hasSpecularGlossiness)
        // specular
        this.pushEntriesDescriptor(
            {func: specularExtension?.getSpecularTexture, callBY: specularExtension},
            materialFactorsArray,
            [specularExtension?.getSpecularFactor() ?? 1],
            inUseTexCoords,
            {func: specularExtension?.getSpecularTextureInfo, callBY: specularExtension},
            "HAS_SPECULAR_MAP", materialInstance,
            "specular"
        )

        // specular color
        this.pushEntriesDescriptor(
            {func: specularExtension?.getSpecularColorTexture, callBY: specularExtension},
            materialFactorsArray,
            specularExtension?.getSpecularColorFactor().flat() ?? [1, 1, 1],
            inUseTexCoords,
            {func: specularExtension?.getSpecularTextureInfo, callBY: specularExtension},
            "HAS_SPECULAR_COLOR_MAP", materialInstance,
            "specular_color"
        )

        ///// transmission
        const transmissionExtension = material.getExtension<Transmission>("KHR_materials_transmission");
        materialInstance.shaderDescriptor.overrides.HAS_TRANSMISSION = Boolean(transmissionExtension && !this.isUnlit && !this.hasSpecularGlossiness)
        // transmission
        this.pushEntriesDescriptor(
            {func: transmissionExtension?.getTransmissionTexture, callBY: transmissionExtension},
            materialFactorsArray,
            [transmissionExtension?.getTransmissionFactor() ?? 0],
            inUseTexCoords,
            {func: transmissionExtension?.getTransmissionTextureInfo, callBY: transmissionExtension},
            "HAS_TRANSMISSION_MAP", materialInstance,
            "transmission"
        )

        //dispersion
        const dispersionExtension = material.getExtension<Dispersion>("KHR_materials_dispersion");
        materialInstance.shaderDescriptor.overrides.HAS_DISPERSION = Boolean(dispersionExtension && !this.isUnlit && !this.hasSpecularGlossiness)
        const dispersion = dispersionExtension?.getDispersion()
        materialFactorsArray.push(dispersion ?? 0)
        //////////// volume
        const volumeExtension = material.getExtension<Volume>("KHR_materials_volume");
        materialInstance.shaderDescriptor.overrides.HAS_VOLUME = Boolean(volumeExtension && !this.isUnlit && !this.hasSpecularGlossiness)
        // thickness
        this.pushEntriesDescriptor(
            {func: volumeExtension?.getThicknessTexture, callBY: volumeExtension},
            materialFactorsArray,
            [volumeExtension?.getThicknessFactor() ?? 0],
            inUseTexCoords,
            {func: volumeExtension?.getThicknessTextureInfo, callBY: volumeExtension},
            "HAS_THICKNESS_MAP", materialInstance,
            "thickness"
        )

        // attenuationDistance
        materialFactorsArray.push(volumeExtension?.getAttenuationDistance() ?? Infinity, 0);
        // attenuationColor
        materialFactorsArray.push(...volumeExtension?.getAttenuationColor() ?? [1, 1, 1]);
        /////// iridescence
        const iridescenceExtension = material.getExtension<Iridescence>("KHR_materials_iridescence");
        materialInstance.shaderDescriptor.overrides.HAS_IRIDESCENCE = Boolean(iridescenceExtension && !this.isUnlit && !this.hasSpecularGlossiness)
        // iridescence
        this.pushEntriesDescriptor(
            {func: iridescenceExtension?.getIridescenceTexture, callBY: iridescenceExtension},
            materialFactorsArray,
            [iridescenceExtension?.getIridescenceFactor() ?? 0.9],
            inUseTexCoords,
            {func: iridescenceExtension?.getIridescenceTextureInfo, callBY: iridescenceExtension},
            "HAS_IRIDESCENCE_MAP", materialInstance,
            "iridescence"
        )

        // iridescence thickness
        materialFactorsArray.push(iridescenceExtension?.getIridescenceThicknessMinimum() ?? 0)
        materialFactorsArray.push(iridescenceExtension?.getIridescenceThicknessMaximum() ?? 1)
        materialFactorsArray.push(iridescenceExtension?.getIridescenceIOR() ?? 0)

        this.pushEntriesDescriptor(
            {func: iridescenceExtension?.getIridescenceThicknessTexture, callBY: iridescenceExtension},
            materialFactorsArray,
            [],
            inUseTexCoords,
            {func: iridescenceExtension?.getIridescenceThicknessTextureInfo, callBY: iridescenceExtension},
            "HAS_IRIDESCENCE_THICKNESS_MAP", materialInstance,
            "iridescence_thickness"
        )
        //////// diffuse transmission
        const diffuseTransmissionExtension = material.getExtension<DiffuseTransmission>("KHR_materials_diffuse_transmission");
        materialInstance.shaderDescriptor.overrides.HAS_DIFFUSE_TRANSMISSION = Boolean(diffuseTransmissionExtension && !this.isUnlit && !this.hasSpecularGlossiness)
        // diffuse transmission
        this.pushEntriesDescriptor(
            {func: diffuseTransmissionExtension?.getDiffuseTransmissionTexture, callBY: diffuseTransmissionExtension},
            materialFactorsArray,
            [diffuseTransmissionExtension?.getDiffuseTransmissionFactor() ?? 0],
            inUseTexCoords,
            {
                func: diffuseTransmissionExtension?.getDiffuseTransmissionTextureInfo,
                callBY: diffuseTransmissionExtension
            },
            "HAS_DIFFUSE_TRANSMISSION_MAP", materialInstance,
            "diffuse_transmission"
        )

        // diffuse transmission color
        this.pushEntriesDescriptor(
            {
                func: diffuseTransmissionExtension?.getDiffuseTransmissionColorTexture,
                callBY: diffuseTransmissionExtension
            },
            materialFactorsArray,
            diffuseTransmissionExtension?.getDiffuseTransmissionColorFactor() ?? [0, 0, 0],
            inUseTexCoords,
            {
                func: diffuseTransmissionExtension?.getDiffuseTransmissionTextureInfo,
                callBY: diffuseTransmissionExtension
            },
            "HAS_DIFFUSE_TRANSMISSION_COLOR_MAP", materialInstance,
            "diffuse_transmission_color"
        )

        // ////// anisotropy
        const anisotropyExtension = material.getExtension<Anisotropy>("KHR_materials_anisotropy");
        materialInstance.shaderDescriptor.overrides.HAS_ANISOTROPY = Boolean(anisotropyExtension && !this.isUnlit && !this.hasSpecularGlossiness)
        materialFactorsArray.push(...[0,
            Math.cos(anisotropyExtension?.getAnisotropyRotation() ?? 0),
            Math.sin(anisotropyExtension?.getAnisotropyRotation() ?? 0),
            anisotropyExtension?.getAnisotropyStrength() ?? 1
        ])
        // anisotropy
        this.pushEntriesDescriptor(
            {func: anisotropyExtension?.getAnisotropyTexture, callBY: anisotropyExtension},
            materialFactorsArray,
            [],
            inUseTexCoords,
            {func: anisotropyExtension?.getAnisotropyTextureInfo, callBY: anisotropyExtension},
            "HAS_ANISOTROPY_MAP", materialInstance,
            "anisotropy"
        )

        // environment
        // intensity
        materialFactorsArray.push(1);
        // rotation
        materialFactorsArray.push(...[
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
        ]);


        this.pushEntriesDescriptor(
            {func: specularGlossinessExtension?.getSpecularGlossinessTexture, callBY: specularGlossinessExtension},
            materialFactorsArray,
            [...specularGlossinessExtension?.getSpecularFactor() ?? [1, 1, 1], specularGlossinessExtension?.getGlossinessFactor() ?? 0],
            inUseTexCoords,
            {func: specularGlossinessExtension?.getSpecularGlossinessTextureInfo, callBY: specularGlossinessExtension},
            "HAS_SPECULAR_GLOSSINESS_MAP", materialInstance,
            "specular_glossiness"
        )
        this.pushEntriesDescriptor(
            {func: specularGlossinessExtension?.getDiffuseTexture, callBY: specularGlossinessExtension},
            materialFactorsArray,
            [...specularGlossinessExtension?.getDiffuseFactor() ?? [1, 1, 1, 1]],
            inUseTexCoords,
            {func: specularGlossinessExtension?.getDiffuseTextureInfo, callBY: specularGlossinessExtension},
            "HAS_SPECULAR_GLOSSINESS_DIFFUSE_MAP", materialInstance,
            "specular_glossiness_diffuse"
        )



        const materialFactorsBuffer = createGPUBuffer(
            BaseLayer.device, new Float32Array(materialFactorsArray),
            GPUBufferUsage.UNIFORM, `${materialInstance.name} material info buffer`, 272
        )
        // pushing entries
        // materialFactors
        materialInstance.setMaterialFactors(materialFactorsBuffer)

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
        console.log(materialFactorsArray)
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

    setDescForNullMats(materialInstance: StandardMaterial) {
        ["HAS_BASE_COLOR_MAP", "HAS_EMISSIVE_STRENGTH", "HAS_METALLIC_ROUGHNESS_MAP", "HAS_NORMAL_MAP", "HAS_AO_MAP", "HAS_EMISSIVE_MAP",
            "HAS_IOR", "HAS_SHEEN", "HAS_SHEEN_COLOR_MAP", "HAS_SHEEN_ROUGHNESS_MAP", "HAS_CLEARCOAT_MAP", "HAS_CLEARCOAT_NORMAL_MAP",
            "HAS_CLEARCOAT_ROUGHNESS_MAP", "HAS_SPECULAR_MAP", "HAS_SPECULAR_COLOR_MAP", "HAS_TRANSMISSION", "HAS_TRANSMISSION_MAP",
            "HAS_DISPERSION", "HAS_VOLUME", "HAS_THICKNESS_MAP", "HAS_IRIDESCENCE_MAP", "HAS_IRIDESCENCE_THICKNESS_MAP", "HAS_DIFFUSE_TRANSMISSION",
            "HAS_DIFFUSE_TRANSMISSION_MAP", "HAS_DIFFUSE_TRANSMISSION_COLOR_MAP", "HAS_ANISOTROPY", "HAS_ANISOTROPY_MAP"]
            .forEach(i => materialInstance.shaderDescriptor.overrides[i] = false)
        const materialFactorsArray: number[] = []
        // base color
        materialFactorsArray.push(1, 1, 1, 1)
        // metallic roughness
        materialFactorsArray.push(1, 0)
        // normal
        materialFactorsArray.push(1)
        // ao
        materialFactorsArray.push(1)
        // emissive
        materialFactorsArray.push(0, 0, 0)
        materialFactorsArray.push(1)
        /////////// extensions

        materialFactorsArray.push(1.5) // ior
        materialFactorsArray.push(1.5) // clearcoat ior
        materialFactorsArray.push(1) // emissive strength
        // sheen color
        materialFactorsArray.push(0, 1, 1, 1)
        // sheen roughness
        materialFactorsArray.push(1)
        // clearcoat
        materialFactorsArray.push(0)
        // clearcoat normal
        materialFactorsArray.push(0)
        // clearcoat roughness
        materialFactorsArray.push(1)
        // specular
        materialFactorsArray.push(1)
        // specular color
        materialFactorsArray.push(...[1, 1, 1]);
        // transmission
        materialFactorsArray.push(0)
        //dispersion
        materialFactorsArray.push(0)
        // thickness
        materialFactorsArray.push(0)
        // attenuationDistance
        materialFactorsArray.push(Infinity, 0);
        // attenuationColor
        materialFactorsArray.push(...[1, 1, 1]);
        // iridescence
        materialFactorsArray.push(1)
        // iridescence thickness
        materialFactorsArray.push(0)
        materialFactorsArray.push(1)
        materialFactorsArray.push(0)

        // diffuse transmission
        materialFactorsArray.push(0)

        // diffuse transmission color
        materialFactorsArray.push(0, 0, 0)

        // ////// anisotropy
        materialFactorsArray.push(...[0,
            1,
            0,
            1
        ])

        // environment
        // intensity
        materialFactorsArray.push(1);
        // rotation
        materialFactorsArray.push(...[
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
        ]);
        // specular glossiness
        // specular
        materialFactorsArray.push(...[1,1,1,1]);
        // diffuse
        materialFactorsArray.push(...[1,1,1,1]);

        const materialFactorsBuffer = createGPUBuffer(
            BaseLayer.device, new Float32Array(materialFactorsArray),
            GPUBufferUsage.UNIFORM, `${materialInstance.name} material info buffer`, 272
        )

        // pushing entries
        // materialFactors
        materialInstance.setMaterialFactors(materialFactorsBuffer)
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
    }
}