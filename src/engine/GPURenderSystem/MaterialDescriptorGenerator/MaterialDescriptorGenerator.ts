import {BindGroupEntryCreationType} from "../GPUCache/GPUCacheTypes.ts";
import {HashCreationBindGroupEntry} from "../Hasher/HashGenerator.ts";
import {
    convertAlphaMode,
    createGPUBuffer,
    getTextureFromData, needsSampler
} from "../../../helpers/global.helper.ts";
import {MaterialBindGroupEntry} from "../../../renderers/modelRenderer.ts";
import {PBRBindPoint, RenderFlag} from "./MaterialDescriptorGeneratorTypes.ts";
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

    public getMaterialBindGroups(
        material: Material,
    ) {
        const entries: BindGroupEntryCreationType[] = []
        const hashEntries: HashCreationBindGroupEntry = []

        const targetRenderData = material.textureMap.get(material.renderMethod)!
        const factors: number[] = [...[targetRenderData.factor].flat()]

        const factorsTypedArray = new Float32Array(factors);
        entries.push({
            bindingPoint: 0,
            typedArray: {
                conversion: createGPUBuffer,
                usage: GPUBufferUsage.UNIFORM,
                label: `${material.name} factors`,
                data: factorsTypedArray,
                conversionType: "buffer"
            },
            materialKey: "Factors"
        })

        hashEntries.push(factorsTypedArray)

        if (targetRenderData.texture) {
            entries.push({
                bindingPoint: 1,
                typedArray: {
                    conversion: getTextureFromData,
                    conversionType: "texture",
                    size: targetRenderData.texture.size,
                    data: targetRenderData.texture.data
                },
                materialKey: RenderFlag[material.renderMethod]
            })


            hashEntries.push(targetRenderData.texture.data)
            material.samplerInfo.descriptor = {
                label: "default sampler",
                addressModeW: "repeat",
                addressModeV: "repeat",
                addressModeU: "repeat",
                minFilter: "linear",
                magFilter: "linear"
            }

            material.samplerInfo.bindPoint = 2
        }

        const alpha = new Float32Array([convertAlphaMode(material.alpha.mode), material.alpha.cutoff]);
        entries.push({
            bindingPoint: targetRenderData.texture ? 3 : 1,
            typedArray: {
                conversion: createGPUBuffer,
                conversionType: "buffer",
                data: alpha,
                label: `${material.name} alphaMode`,
                usage: GPUBufferUsage.UNIFORM
            },
            materialKey: "Alpha"
        })
        hashEntries.push(alpha)

        return {
            entries,
            hashEntries,
            layout: targetRenderData.texture ? MaterialDescriptorGenerator.inspectLayouts[0] : MaterialDescriptorGenerator.inspectLayouts[1]
        }
    }

    private getTechniqueBindGroupLayout(dataMap: Map<RenderFlag, {
        texture: {
            data: TypedArray
            size: vec2
        } | null
        factor: number | number[]
        pbrBindPoint: number
        pbrFactorStartPoint: number
    }>) {
        const layoutEntries: GPUBindGroupLayoutEntry[] = []
        const bindSampler = needsSampler(dataMap)
        if (bindSampler) layoutEntries.push({
            sampler: {
                type: "filtering"
            },
            visibility: GPUShaderStage.FRAGMENT,
            binding: PBRBindPoint.SAMPLER
        })
        layoutEntries.push({
            buffer: {
                type: "uniform"
            },
            visibility: GPUShaderStage.FRAGMENT,
            binding: PBRBindPoint.ALPHA
        })
        layoutEntries.push({
            buffer: {
                type: "read-only-storage"
            },
            visibility: GPUShaderStage.FRAGMENT,
            binding: PBRBindPoint.FACTORS
        })
        const pushedPBRIndices = new Map<number, boolean>();
        dataMap.forEach((value) => {
            if (value.texture && !pushedPBRIndices.has(value.pbrBindPoint)) {
                layoutEntries.push({
                    texture: {
                        sampleType: "float",
                    },
                    visibility: GPUShaderStage.FRAGMENT,
                    binding: value.pbrBindPoint
                })
                pushedPBRIndices.set(value.pbrBindPoint, true)
            }
        })

        return layoutEntries
    }

    getTechniqueBindGroup(material: Material): MaterialBindGroupEntry {

        const entries: BindGroupEntryCreationType[] = []
        const hashEntries: HashCreationBindGroupEntry = []
        const bindSampler = needsSampler(material.textureMap);
        // sampler
        if (bindSampler) {

        }

        // alpha
        const alpha = new Float32Array([convertAlphaMode(material.alpha.mode), material.alpha.cutoff]);
        entries.push({
            bindingPoint: PBRBindPoint.ALPHA,
            typedArray: {
                conversion: createGPUBuffer,
                conversionType: "buffer",
                data: alpha,
                label: `${material.name} alphaMode`,
                usage: GPUBufferUsage.UNIFORM
            },
            materialKey: "Alpha"
        })
        hashEntries.push(alpha)

        // factors
        const factorsArray: number[] = []
        const pushedPBRIndices = new Map<number, boolean>();
        material.textureMap.forEach((item, key) => {
            if (item.texture && !pushedPBRIndices.has(item.pbrBindPoint)) {
                entries.push({
                    bindingPoint: item.pbrBindPoint,
                    typedArray: {
                        conversion: getTextureFromData,
                        conversionType: "texture",
                        size: item.texture?.size,
                        data: item.texture?.data
                    },
                    materialKey: RenderFlag[key]
                })
                pushedPBRIndices.set(item.pbrBindPoint, true)
                hashEntries.push(item.texture.data)
            }
            const factors = [item.factor].flat()
            factors.forEach((factor, i) => {
                factorsArray[item.pbrFactorStartPoint + i] = factor
            })
        })

        const factorsTypedArray = new Float32Array(factorsArray);
        entries.push({
            bindingPoint: PBRBindPoint.FACTORS,
            typedArray: {
                conversion: createGPUBuffer,
                conversionType: "buffer",
                data: factorsTypedArray,
                label: `${material.name} factors`,
                usage: GPUBufferUsage.STORAGE,
            },
            materialKey: "Factors"
        })
        hashEntries.push(factorsTypedArray)
        if (bindSampler) {
            material.samplerInfo.descriptor = {
                label: "default sampler",
                addressModeW: "repeat",
                addressModeV: "repeat",
                addressModeU: "repeat",
                minFilter: "linear",
                magFilter: "linear"
            }
            material.samplerInfo.bindPoint = PBRBindPoint.SAMPLER
        }

        return {
            entries,
            hashEntries,
            layout: this.getTechniqueBindGroupLayout(material.textureMap)
        }

    }
}