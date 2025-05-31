import {
    DecodedMaterialFlags,
    MaterialData,
    MaterialFlags,
    ResourcesBindingPoints
} from "../loader/loaderTypes.ts";
import {TypedArray, vec2} from "@gltf-transform/core";
import {createGPUBuffer, getTextureFromData} from "../../helpers/global.helper.ts";
import {BaseLayer} from "../../layers/baseLayer.ts";

type UniqueBindGroupLayout = {
    hash: number,
    bindGroupLayout: GPUBindGroupLayout,
    decodedHash: DecodedMaterialFlags
}

export class MaterialManager extends BaseLayer {
    protected static readonly pipelineResourceHashList: number[] = [];
    protected static readonly pipelineResourcesList: UniqueBindGroupLayout[] = []

    protected static device: GPUDevice;
    private _initialized: boolean = false;

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx);
        if (this.constructor === MaterialManager && !this._initialized) {
            MaterialManager.device = device;
            this._initialized = true;
        }
    }


    protected static set appendPipelineResourceHash(hash: number) {
        const alreadyExist: boolean = this.pipelineResourceHashList.some(item => item === hash);
        if (!alreadyExist) {
            this.pipelineResourceHashList.push(hash);
            this.createBindGroupLayout(hash)
        }
    }

    protected static decodeMaterialHash(hash: number): DecodedMaterialFlags {
        const hasBaseColorTexture = (hash & MaterialFlags.HasBaseColorTexture) !== 0;
        const hasEmissiveTexture = (hash & MaterialFlags.HasEmissiveTexture) !== 0;
        const hasOcclusionTexture = (hash & MaterialFlags.HasOcclusionTexture) !== 0;
        const hasNormalTexture = (hash & MaterialFlags.HasNormalTexture) !== 0;
        const hasMetallicRoughnessTex = (hash & MaterialFlags.HasMetallicRoughnessTex) !== 0;
        const hasTransmissionTexture = (hash & MaterialFlags.HasTransmissionTexture) !== 0;
        const hasGlossinessTexture = (hash & MaterialFlags.HasGlossinessTexture) !== 0;
        const hasSpecularTexture = (hash & MaterialFlags.HasSpecularTexture) !== 0;
        const hasSpecularColorTexture = (hash & MaterialFlags.HasSpecularColorTexture) !== 0;
        const hasGlossinessSpecularTexture = (hash & MaterialFlags.HasGlossinessSpecularTexture) !== 0;
        const hasClearcoatTexture = (hash & MaterialFlags.HasClearcoatTexture) !== 0;
        const hasClearcoatRoughnessTexture = (hash & MaterialFlags.HasClearcoatRoughnessTexture) !== 0;
        const hasClearcoatNormalTexture = (hash & MaterialFlags.HasClearcoatNormalTexture) !== 0;

        const alphaBits = hash & MaterialFlags.AlphaMode_Mask;
        let alphaMode: 'opaque' | 'mask' | 'blend';
        switch (alphaBits) {
            case MaterialFlags.AlphaMode_MaskOnly:
                alphaMode = 'mask';
                break;
            case MaterialFlags.AlphaMode_Blend:
                alphaMode = 'blend';
                break;
            default:
                alphaMode = 'opaque';
        }

        // Other flags
        const unlit = (hash & MaterialFlags.IsUnlit) !== 0;
        let hasSampler = false;
        if (
            hasSpecularTexture ||
            hasEmissiveTexture ||
            hasBaseColorTexture ||
            hasGlossinessTexture ||
            hasOcclusionTexture ||
            hasTransmissionTexture ||
            hasMetallicRoughnessTex ||
            hasNormalTexture ||
            hasSpecularColorTexture ||
            hasGlossinessSpecularTexture ||
            hasClearcoatTexture ||
            hasClearcoatRoughnessTexture ||
            hasClearcoatNormalTexture
        ) hasSampler = true;

        return {
            hasBaseColorTexture,
            hasEmissiveTexture,
            hasOcclusionTexture,
            hasNormalTexture,
            hasMetallicRoughnessTex,
            hasTransmissionTexture,
            hasGlossinessTexture,
            hasSpecularTexture,
            hasSampler,
            alphaMode,
            hasSpecularColorTexture,
            hasGlossinessSpecularTexture,
            hasClearcoatTexture,
            hasClearcoatRoughnessTexture,
            hasClearcoatNormalTexture,
            unlit,
        };
    }

    protected static createBindGroupLayout(hash: number) {
        const decodedFlags = this.decodeMaterialHash(hash)

        const bindGroupEntries: GPUBindGroupLayoutEntry[] = []

        if (decodedFlags.hasBaseColorTexture) bindGroupEntries.push({
            binding: ResourcesBindingPoints.BASE_COLOR_TEXTURE,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {sampleType: "float"}
        })
        if (decodedFlags.hasEmissiveTexture) bindGroupEntries.push({
            binding: ResourcesBindingPoints.EMISSIVE_TEXTURE,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {sampleType: "float"}
        })
        if (decodedFlags.hasOcclusionTexture) bindGroupEntries.push({
            binding: ResourcesBindingPoints.OCCLUSION_TEXTURE,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {sampleType: "float"}
        })
        if (decodedFlags.hasNormalTexture) bindGroupEntries.push({
            binding: ResourcesBindingPoints.NORMAL_TEXTURE,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {sampleType: "float"}
        })
        if (decodedFlags.hasMetallicRoughnessTex) bindGroupEntries.push({
            binding: ResourcesBindingPoints.METALLIC_ROUGHNESS_TEXTURE,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {sampleType: "float"}
        })
        if (decodedFlags.hasTransmissionTexture) bindGroupEntries.push({
            binding: ResourcesBindingPoints.TRANSMISSION_TEXTURE,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {sampleType: "float"}
        })
        if (decodedFlags.hasGlossinessTexture) bindGroupEntries.push({
            binding: ResourcesBindingPoints.GLOSSINESS_TEXTURE,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {sampleType: "float"}
        })
        if (decodedFlags.hasSpecularTexture) bindGroupEntries.push({
            binding: ResourcesBindingPoints.SPECULAR_TEXTURE,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {sampleType: "float"}
        })
        if (decodedFlags.hasSampler) bindGroupEntries.push({
            binding: ResourcesBindingPoints.SAMPLER,
            sampler: {
                type: "filtering"
            },
            visibility: GPUShaderStage.FRAGMENT
        })
        if (decodedFlags.hasGlossinessSpecularTexture) bindGroupEntries.push({
            binding: ResourcesBindingPoints.GLOSSINESS_SPECULAR_TEXTURE,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {sampleType: "float"}
        })
        if (decodedFlags.hasSpecularColorTexture) bindGroupEntries.push({
            binding: ResourcesBindingPoints.SPECULAR_COLOR_TEXTURE,
            texture: {sampleType: "float"},
            visibility: GPUShaderStage.FRAGMENT
        })
        if (decodedFlags.hasClearcoatTexture) bindGroupEntries.push({
            binding: ResourcesBindingPoints.CLEARCOAT_TEXTURE,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {sampleType: "float"}
        })
        if (decodedFlags.hasClearcoatRoughnessTexture) bindGroupEntries.push({
            binding: ResourcesBindingPoints.CLEARCOAT_ROUGHNESS_TEXTURE,
            texture: {sampleType: "float"},
            visibility: GPUShaderStage.FRAGMENT
        })
        if (decodedFlags.hasClearcoatNormalTexture) bindGroupEntries.push({
            binding: ResourcesBindingPoints.CLEARCOAT__NORMAL_TEXTURE,
            texture: {sampleType: "float"},
            visibility: GPUShaderStage.FRAGMENT
        })
        bindGroupEntries.push({
            binding: ResourcesBindingPoints.ALPHA,
            buffer: {type: "uniform"},
            visibility: GPUShaderStage.FRAGMENT
        })

        bindGroupEntries.push({
            binding: ResourcesBindingPoints.FACTORS,
            buffer: {
                type: "read-only-storage"
            },
            visibility: GPUShaderStage.FRAGMENT
        })

        const bindGroupLayout = this.device.createBindGroupLayout({
            label: `material layout ${hash}`,
            entries: bindGroupEntries
        })

        this.pipelineResourcesList.push({
            hash,
            bindGroupLayout: bindGroupLayout,
            decodedHash: decodedFlags,
        })
    }


    protected static async getRenderSetup(hash: number, data: MaterialData) {
        const {
            bindGroupLayout,
            decodedHash,
        } = this.pipelineResourcesList.find(item => item.hash === hash) as UniqueBindGroupLayout
        const entries: GPUBindGroupEntry[] = [];
        const factors = []

        if (decodedHash.hasBaseColorTexture) {
            entries.push({
                binding: ResourcesBindingPoints.BASE_COLOR_TEXTURE,
                resource: (await getTextureFromData(this.device, data.base.texture?.size as vec2, data.base.texture?.array as TypedArray)).createView()
            })
        }
        factors.push(...data.base.factor)


        if (decodedHash.hasEmissiveTexture) {
            entries.push({
                binding: ResourcesBindingPoints.EMISSIVE_TEXTURE,
                resource: (await getTextureFromData(this.device, data.emissive.texture?.size as vec2, data.emissive.texture?.array as TypedArray)).createView()
            })
        }
        factors.push(...data.emissive.factor)

        if (decodedHash.hasOcclusionTexture) {
            entries.push({
                binding: ResourcesBindingPoints.OCCLUSION_TEXTURE,
                resource: (await getTextureFromData(this.device, data.occlusion.texture?.size as vec2, data.occlusion.texture?.array as TypedArray)).createView()
            })
        }
        factors.push(data.occlusion.strength)

        if (decodedHash.hasNormalTexture) {
            entries.push({
                binding: ResourcesBindingPoints.NORMAL_TEXTURE,
                resource: (await getTextureFromData(this.device, data.normal.texture?.size as vec2, data.normal.texture?.array as TypedArray)).createView()
            })
        }

        factors.push(data.normal.scale)

        if (decodedHash.hasMetallicRoughnessTex) {
            entries.push({
                binding: ResourcesBindingPoints.METALLIC_ROUGHNESS_TEXTURE,
                resource: (await getTextureFromData(this.device, data.metallicRoughness.texture?.size as vec2, data.metallicRoughness.texture?.array as TypedArray)).createView()
            })
        }
        factors.push(...data.metallicRoughness.factor)

        if (decodedHash.hasTransmissionTexture) {
            entries.push({
                binding: ResourcesBindingPoints.TRANSMISSION_TEXTURE,
                resource: (await getTextureFromData(this.device, (data.transmission as any).texture?.size as vec2, (data.transmission as any).texture?.array as TypedArray)).createView()
            })
        }

        factors.push(data?.transmission?.factor ?? 0)

        if (decodedHash.hasGlossinessTexture) {
            entries.push({
                binding: ResourcesBindingPoints.GLOSSINESS_TEXTURE,
                resource: (await getTextureFromData(this.device, (data.glossiness as any).texture?.size as vec2, (data.glossiness as any).texture?.array as TypedArray)).createView()
            })
        }

        factors.push(data?.glossiness?.factor ?? 0)

        if (decodedHash.hasSpecularTexture) {
            entries.push({
                binding: ResourcesBindingPoints.SPECULAR_TEXTURE,
                resource: (await getTextureFromData(this.device, (data.specular as any).texture?.size as vec2, (data.specular as any).texture?.array as TypedArray)).createView()
            })
        }
        factors.push(data?.specular?.factor ?? 0)
        factors.push(data?.emissiveStrength ?? 1)

        if (decodedHash.hasSampler) {
            const sampler = this.device.createSampler({
                magFilter: "linear",
                minFilter: "linear",
                addressModeU: "repeat",
                addressModeV: "repeat",
                addressModeW: "repeat",
            })
            entries.push({
                binding: ResourcesBindingPoints.SAMPLER,
                resource: sampler
            })
        }

        entries.push({
            binding: ResourcesBindingPoints.ALPHA,
            resource: {
                buffer: createGPUBuffer(this.device, new Float32Array([
                    decodedHash.alphaMode === "opaque" ? 0 : decodedHash.alphaMode === "blend" ? 1 : 2
                ]), GPUBufferUsage.UNIFORM, "")
            }
        })
        factors.push(data.alpha.cutoffAlpha)

        if (decodedHash.hasGlossinessSpecularTexture) {
            entries.push({
                binding: ResourcesBindingPoints.GLOSSINESS_SPECULAR_TEXTURE,
                resource: (await getTextureFromData(this.device, (data.glossinessSpecular as any).texture?.size as vec2, (data.glossinessSpecular as any).texture?.array as TypedArray)).createView()
            })
        }

        factors.push(...data?.glossinessSpecular?.factor ?? [0, 0, 0])


        if (decodedHash.hasSpecularColorTexture) {
            entries.push({
                binding: ResourcesBindingPoints.SPECULAR_COLOR_TEXTURE,
                resource: (await getTextureFromData(this.device, (data.specularColor as any).texture?.size as vec2, (data.specularColor as any).texture?.array as TypedArray)).createView()
            })
        }
        factors.push(...data?.specularColor?.factor ?? [0, 0, 0])

        if (decodedHash.hasClearcoatTexture) {
            entries.push({
                binding: ResourcesBindingPoints.CLEARCOAT_TEXTURE,
                resource: (await getTextureFromData(this.device, (data.clearcoat as any).texture?.size as vec2, (data.clearcoat as any).texture?.array as TypedArray)).createView()
            })
        }
        factors.push(data?.clearcoat?.factor ?? 0)

        if (decodedHash.hasClearcoatRoughnessTexture) {
            entries.push({
                binding: ResourcesBindingPoints.CLEARCOAT_ROUGHNESS_TEXTURE,
                resource: (await getTextureFromData(this.device, (data.clearcoat as any).roughnessTexture?.size as vec2, (data.clearcoat as any).roughnessTexture?.array as TypedArray)).createView()
            })
        }
        factors.push(data?.clearcoat?.roughnessFactor ?? 0)

        if (decodedHash.hasClearcoatNormalTexture) {
            entries.push({
                binding: ResourcesBindingPoints.CLEARCOAT__NORMAL_TEXTURE,
                resource: (await getTextureFromData(this.device, (data.clearcoat as any).normalTexture?.size as vec2, (data.clearcoat as any).normalTexture?.array as TypedArray)).createView()
            })
        }
        factors.push(data?.clearcoat?.normalScale ?? 0)


        entries.push({
            binding: ResourcesBindingPoints.FACTORS,
            resource: {
                buffer: createGPUBuffer(this.device, new Float32Array(factors), GPUBufferUsage.STORAGE, `factors buffer ${hash}`)
            }
        })
        return {
            bindGroup: this.device.createBindGroup({
                label: `material bindgroup ${hash}`,
                entries,
                layout: bindGroupLayout
            }),
            layout: bindGroupLayout,
            decodedMaterial: decodedHash
        }
    }
}