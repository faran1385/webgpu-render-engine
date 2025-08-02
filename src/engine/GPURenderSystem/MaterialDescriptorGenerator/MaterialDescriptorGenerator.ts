import {BindGroupEntryCreationType} from "../GPUCache/GPUCacheTypes.ts";
import {HashCreationBindGroupEntry} from "../Hasher/HashGenerator.ts";
import {
    createGPUBuffer,
    getTextureFromData, needsSampler
} from "../../../helpers/global.helper.ts";
import {StandardMaterialBindPoint, RenderFlag} from "./MaterialDescriptorGeneratorTypes.ts";
import {TypedArray, vec2} from "@gltf-transform/core";
import {Material} from "../../Material/Material.ts";

export class MaterialDescriptorGenerator {
    static device: GPUDevice;
    static inspectLayouts: GPUBindGroupLayoutEntry[][] = []

    constructor(device: GPUDevice) {
        MaterialDescriptorGenerator.device = device;
        MaterialDescriptorGenerator.inspectLayouts.push([
            {
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: {
                    type: "uniform"
                }
            }, {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {
                    sampleType: "float"
                }
            },
            {
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: {
                    type: "filtering"
                }
            },
            {
                binding: 3,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: {
                    type: "uniform"
                }
            }
        ], [
            {
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: {
                    type: "uniform"
                }
            },
            {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: {
                    type: "uniform"
                }
            }
        ])
    }

    private getTechniqueBindGroupLayout(dataMap: Map<RenderFlag, {
        texture: {
            data: TypedArray
            size: vec2
        } | null
        factor: number | number[]
        bindPoint: number
        factorStartPoint: number
    }>) {
        const layoutEntries: GPUBindGroupLayoutEntry[] = []
        const bindSampler = needsSampler(dataMap)
        if (bindSampler) layoutEntries.push({
            sampler: {
                type: "filtering"
            },
            visibility: GPUShaderStage.FRAGMENT,
            binding: StandardMaterialBindPoint.SAMPLER
        })

        layoutEntries.push({
            buffer: {
                type: "read-only-storage"
            },
            visibility: GPUShaderStage.FRAGMENT,
            binding: StandardMaterialBindPoint.FACTORS
        })
        const pushedIndices = new Map<number, boolean>();
        dataMap.forEach((value) => {
            if (value.texture && !pushedIndices.has(value.bindPoint)) {
                layoutEntries.push({
                    texture: {
                        sampleType: "float",
                    },
                    visibility: GPUShaderStage.FRAGMENT,
                    binding: value.bindPoint
                })
                pushedIndices.set(value.bindPoint, true)
            }
        })
        return layoutEntries
    }

    getTechniqueBindGroup(material: Material): {
        entries: BindGroupEntryCreationType[],
        hashEntries: HashCreationBindGroupEntry,
        layout: null | GPUBindGroupLayoutEntry[],
        sampler: GPUSamplerDescriptor | null
    } {
        const entries: BindGroupEntryCreationType[] = []
        const hashEntries: HashCreationBindGroupEntry = []
        if (material.initialized) {
            material.resources.forEach((resource, key) => {
                if (resource instanceof GPUSampler) {
                    if (material.descriptor.sampler) material.resources.delete(key)
                } else if (resource instanceof GPUTexture) {
                    hashEntries.push(resource)
                    entries.push({
                        textureDescriptor: {
                            texture: resource,
                            viewDescriptor: {}
                        },
                        bindingPoint: StandardMaterialBindPoint[key as any] as any
                    })
                } else if (resource instanceof GPUBuffer) {
                    hashEntries.push(resource)
                    entries.push({
                        buffer: resource,
                        bindingPoint: StandardMaterialBindPoint[key as any] as any
                    })
                }
            })
            return {
                entries,
                hashEntries,
                layout: null,
                sampler: material.descriptor.sampler
            }
        } else {
            const bindSampler = needsSampler(material.textureDataMap);

            // factors
            const factorsArray: number[] = []
            const pushedIndices = new Map<number, boolean>();
            material.textureDataMap.forEach((item, renderFlag) => {
                if (item.texture && !pushedIndices.has(item.bindPoint)) {
                    entries.push({
                        bindingPoint: item.bindPoint,
                        typedArray: {
                            conversion: getTextureFromData,
                            conversionType: "texture",
                            size: item.texture?.size,
                            data: item.texture?.data,
                            format: item.bindPoint === StandardMaterialBindPoint.BASE_COLOR ? "rgba8unorm-srgb" : "rgba8unorm",
                            renderFlag
                        }
                    })
                    pushedIndices.set(item.bindPoint, true)
                    hashEntries.push(item.texture.data)
                }
                const factors = [item.factor].flat()
                factors.forEach((factor, i) => {
                    factorsArray[item.factorStartPoint + i] = factor
                })
            })
            const factorsTypedArray = new Float32Array(factorsArray);
            entries.push({
                bindingPoint: StandardMaterialBindPoint.FACTORS,
                typedArray: {
                    conversion: createGPUBuffer,
                    conversionType: "buffer",
                    data: factorsTypedArray,
                    label: `${material.name} factors`,
                    usage: GPUBufferUsage.STORAGE,
                },
                materialResourcesKey: StandardMaterialBindPoint[StandardMaterialBindPoint.FACTORS]
            })
            hashEntries.push(factorsTypedArray)
            return {
                entries,
                hashEntries,
                layout: this.getTechniqueBindGroupLayout(material.textureDataMap),
                sampler: bindSampler ? {
                    label: "default sampler",
                    magFilter: "linear",
                    minFilter: "linear",
                    mipmapFilter: "linear",
                    addressModeU: "repeat",
                    addressModeV: "repeat",
                } : null
            }
        }
    }


}