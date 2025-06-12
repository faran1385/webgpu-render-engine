import {BindGroupEntryCreationType} from "../GPUCache/GPUCacheTypes.ts";
import {hashCreationBindGroupEntry} from "../Hasher/HashGenerator.ts";
import {convertAlphaMode, createGPUBuffer, getTextureFromData} from "../../../helpers/global.helper.ts";
import {Material, Texture, TypedArray, vec2} from "@gltf-transform/core";
import {Clearcoat, EmissiveStrength, Specular, Transmission} from "@gltf-transform/extensions";

import {
    MaterialBindGroupEntry, BindGroupEntryLayout,
    ShaderCodeEntry,
    SmartRenderInitEntryPassType, PipelineEntry
} from "../../../renderers/modelRenderer.ts";
import {
    baseColorFragment, clearcoatFragments,
    emissiveFragments, metallicFragments,
    normalFragments,
    occlusionFragments,
    opacityFragments, roughnessFragments, specularFragments, transmissionFragments, vertexShaderCodes
} from "./shaderCodes.ts";
import {SceneObject} from "../../SceneObject/sceneObject.ts";


type CallableTexture =
    "getBaseColorTexture"
    | "getEmissiveTexture"
    | "getMetallicRoughnessTexture"
    | "getNormalTexture"
    | "getOcclusionTexture";
type CallableFactor =
    "getBaseColorFactor"
    | "getEmissiveFactor"
    | "getNormalScale"
    | "getOcclusionStrength"
    | "getMetallicFactor"
    | "getRoughnessFactor";

type callFrom = { texture: CallableTexture, factor: CallableFactor }


export class SmartRender {
    static defaultSampler: GPUSampler;
    static device: GPUDevice;
    static ctx: GPUCanvasContext;
    static initialized: boolean = false;
    static defaultMaterialBindGroupLayout: GPUBindGroupLayoutEntry[][] = []
    static defaultGeometryBindGroupLayout: GPUBindGroupLayoutEntry[][] = []

    constructor(device: GPUDevice, ctx: GPUCanvasContext) {
        if (this.constructor === SmartRender && !SmartRender.initialized) {
            SmartRender.initialized = true;
            SmartRender.device = device;
            SmartRender.ctx = ctx;
            SmartRender.defaultSampler = device.createSampler({
                label: "default sampler",
                addressModeW: "repeat",
                addressModeV: "repeat",
                addressModeU: "repeat",
                minFilter: "linear",
                magFilter: "linear"
            });

            SmartRender.defaultGeometryBindGroupLayout.push([{
                binding: 0,
                buffer: {
                    type: "uniform",
                },
                visibility: GPUShaderStage.VERTEX
            }], [{
                binding: 0,
                buffer: {
                    type: "uniform",
                },
                visibility: GPUShaderStage.VERTEX
            }, {
                binding: 1,
                buffer: {
                    type: "read-only-storage",
                },
                visibility: GPUShaderStage.VERTEX
            }])
            SmartRender.defaultMaterialBindGroupLayout.push([
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
    }

    private getGeometryBindGroups(sceneObjects: SceneObject[]) {

        return {
            geometryBindGroupData: sceneObjects.map(sceneObject => {
                sceneObject.createModelBuffer(SmartRender.device, sceneObject.worldMatrix)
                const entries: (GPUBindGroupEntry & { name?: "model" | "normal" })[] = [
                    {
                        binding: 0,
                        resource: {
                            buffer: sceneObject.modelBuffer as GPUBuffer
                        },
                        name: "model"
                    },
                ]

                return {
                    entries,
                    primitivesId: (sceneObject.primitivesData as any).map((prim: any) => prim.id)
                }
            })
        }
    }

    private getMaterialBindGroups(
        sceneObjects: SceneObject[],
        callFrom: callFrom,
        getExtra: ((material: Material) => {
            texture: {
                data: TypedArray,
                size: vec2,
                usedUv: number
            } | null,
            factor: number[] | number,
        }) | undefined = undefined
    ) {
        const usedTextureUvIndices: number[] = []
        return {
            groups: sceneObjects.map(sceneObject => {
                if (sceneObject.mesh && sceneObject.primitivesData && sceneObject.primitivesData.length > 0) {

                    return sceneObject.primitivesData.map((prim, i): MaterialBindGroupEntry => {
                        const entries: BindGroupEntryCreationType[] = []
                        const hashEntries: hashCreationBindGroupEntry = []

                        const factors: number[] = [
                            ...[prim.material[callFrom.factor]()].flat()
                        ]
                        if (getExtra) {
                            factors.push(...[getExtra(prim.material).factor].flat())
                        }

                        const factorsTypedArray = new Float32Array(factors);
                        entries.push({
                            bindingPoint: 0,
                            typedArray: {
                                conversion: createGPUBuffer,
                                usage: GPUBufferUsage.UNIFORM,
                                label: `${sceneObject.name} factors at prim : ${i}`,
                                data: factorsTypedArray,
                                conversionType: "buffer"
                            },
                        })

                        hashEntries.push(factorsTypedArray)
                        const infoKey = callFrom.texture + 'Info' as any

                        if (prim.material[callFrom.texture]()) {
                            usedTextureUvIndices.push((prim.material as any)[infoKey]()?.getTexCoord() as number)
                            const image = (prim.material[callFrom.texture]() as Texture).getImage() as Uint8Array
                            entries.push({
                                bindingPoint: 1,
                                typedArray: {
                                    conversion: getTextureFromData,
                                    conversionType: "texture",
                                    size: (prim.material[callFrom.texture]() as Texture).getSize() as vec2,
                                    data: image
                                },
                            })

                            entries.push({
                                bindingPoint: 2,
                                sampler: SmartRender.defaultSampler
                            })
                            hashEntries.push(image)
                            hashEntries.push({
                                label: "default sampler",
                                addressModeW: "repeat",
                                addressModeV: "repeat",
                                addressModeU: "repeat",
                                minFilter: "linear",
                                magFilter: "linear"
                            })
                        }
                        const alpha = new Float32Array([convertAlphaMode(prim.material.getAlphaMode()), prim.material.getAlphaCutoff()]);
                        entries.push({
                            bindingPoint: prim.material[callFrom.texture]() ? 3 : 1,
                            typedArray: {
                                conversion: createGPUBuffer,
                                conversionType: "buffer",
                                data: alpha,
                                label: `${sceneObject.name} alphaMode at prim : ${i}`,
                                usage: GPUBufferUsage.UNIFORM
                            },
                        })

                        hashEntries.push(alpha)

                        return {
                            entries,
                            material: prim.material,
                            hashEntries,
                            primitiveId: prim.id
                        }
                    })
                }
            }).flat(),
            usedTextureUvIndices: usedTextureUvIndices
        }
    }

    private getPipelineDescriptors(sceneObjects: SceneObject[], usedTextureUvIndices: number[]): PipelineEntry {
        const output: PipelineEntry = []
        sceneObjects.forEach(sceneObject => {
            if (sceneObject.mesh && sceneObject.primitivesData && sceneObject.primitivesData.length > 0) {
                sceneObject.primitivesData.forEach((prim, i) => {
                    const buffers: (GPUVertexBufferLayout & { name: string; })[] = [{
                        arrayStride: 3 * 4,
                        attributes: [{
                            offset: 0,
                            shaderLocation: 0,
                            format: "float32x3"
                        }],
                        name: 'POSITION'
                    }]

                    if (prim.dataList.get(`TEXCOORD_${usedTextureUvIndices[i]}`)) {
                        buffers.push({
                            arrayStride: 2 * 4,
                            attributes: [{
                                offset: 0,
                                shaderLocation: 1,
                                format: "float32x2"
                            }],
                            name: `TEXCOORD_${usedTextureUvIndices[i]}`
                        })
                    }

                    const isDoubleSided = prim.material.getDoubleSided()
                    const isTransparent = prim.material.getAlphaMode() === "BLEND"

                    if (isTransparent && isDoubleSided) {
                        output.push({
                            sceneObject,
                            primitiveId: prim.id,
                            side: "front",
                            prim,
                            primitivePipelineDescriptor: {
                                primitive: {
                                    cullMode: "front",
                                    frontFace: "ccw",
                                },
                                depthStencil: {
                                    depthCompare: "less",
                                    depthWriteEnabled: false,
                                    format: "depth24plus"
                                },
                                targets: [{
                                    writeMask: GPUColorWrite.ALL,
                                    blend: {
                                        color: {
                                            srcFactor: "src-alpha",
                                            dstFactor: "one-minus-src-alpha",
                                            operation: "add",
                                        },
                                        alpha: {
                                            srcFactor: "one",
                                            dstFactor: "zero",
                                            operation: "add",
                                        },
                                    },
                                    format: SmartRender.ctx.getConfiguration()?.format as GPUTextureFormat
                                }],
                                buffers
                            }
                        })

                        output.push({
                            primitiveId: prim.id,
                            side: "back",
                            prim,
                            sceneObject,
                            primitivePipelineDescriptor: {
                                primitive: {
                                    cullMode: "back",
                                    frontFace: "ccw",
                                },
                                depthStencil: {
                                    depthCompare: "less",
                                    depthWriteEnabled: false,
                                    format: "depth24plus"
                                },
                                targets: [{
                                    writeMask: GPUColorWrite.ALL,
                                    blend: {
                                        color: {
                                            srcFactor: "src-alpha",
                                            dstFactor: "one-minus-src-alpha",
                                            operation: "add",
                                        },
                                        alpha: {
                                            srcFactor: "one",
                                            dstFactor: "zero",
                                            operation: "add",
                                        },
                                    },
                                    format: SmartRender.ctx.getConfiguration()?.format as GPUTextureFormat
                                }],
                                buffers
                            }
                        })

                    } else {
                        output.push({
                            primitiveId: prim.id,
                            prim,
                            sceneObject,
                            primitivePipelineDescriptor: {
                                primitive: {
                                    cullMode: isDoubleSided ? "none" : "back",
                                },
                                depthStencil: {
                                    depthCompare: "less",
                                    depthWriteEnabled: !isTransparent,
                                    format: "depth24plus"
                                },
                                targets: [{
                                    writeMask: GPUColorWrite.ALL,
                                    blend: isTransparent ? {
                                        color: {
                                            srcFactor: "src-alpha",
                                            dstFactor: "one-minus-src-alpha",
                                            operation: "add",
                                        },
                                        alpha: {
                                            srcFactor: "one",
                                            dstFactor: "zero",
                                            operation: "add",
                                        },
                                    } : undefined,
                                    format: SmartRender.ctx.getConfiguration()?.format as GPUTextureFormat
                                }],
                                buffers
                            }
                        })
                    }
                })
            }
        })

        return output
    }

    private getExtensionMaterialBindGroups(
        sceneObjects: SceneObject[],
        getExtra: ((material: Material) => {
            texture: {
                data: TypedArray,
                size: vec2,
                usedUv: number
            } | null,
            factor: number[] | number,
        })
    ) {
        const usedTextureUvIndices: number[] = []
        return {
            groups: sceneObjects.map(sceneObject => {
                if (sceneObject.mesh && sceneObject.primitivesData && sceneObject.primitivesData.length > 0) {
                    sceneObject.primitivesData.map((prim, i) => {
                        const entries: BindGroupEntryCreationType[] = []
                        const hashEntries: hashCreationBindGroupEntry = []
                        const extra = getExtra(prim.material);
                        const factorsTypedArray = new Float32Array([...[extra.factor].flat()]);

                        entries.push({
                            bindingPoint: 0,
                            typedArray: {
                                conversion: createGPUBuffer,
                                usage: GPUBufferUsage.UNIFORM,
                                label: `${sceneObject.name} factors at prim : ${i}`,
                                data: factorsTypedArray,
                                conversionType: "buffer"
                            },
                        })
                        hashEntries.push(factorsTypedArray)
                        if (extra.texture) {
                            usedTextureUvIndices.push(extra.texture.usedUv)

                            entries.push({
                                bindingPoint: 1,
                                typedArray: {
                                    conversion: getTextureFromData,
                                    conversionType: "texture",
                                    size: extra.texture.size,
                                    data: extra.texture.data
                                },
                            })

                            entries.push({
                                bindingPoint: 2,
                                sampler: SmartRender.defaultSampler
                            })
                            hashEntries.push(extra.texture.data)
                            hashEntries.push({
                                label: "default sampler",
                                addressModeW: "repeat",
                                addressModeV: "repeat",
                                addressModeU: "repeat",
                                minFilter: "linear",
                                magFilter: "linear"
                            })
                        }
                        const alpha = new Float32Array([convertAlphaMode(prim.material.getAlphaMode()), prim.material.getAlphaCutoff()]);
                        entries.push({
                            bindingPoint: extra.texture ? 3 : 1,
                            typedArray: {
                                conversion: createGPUBuffer,
                                conversionType: "buffer",
                                data: alpha,
                                label: `${sceneObject.name} alphaMode at prim : ${i}`,
                                usage: GPUBufferUsage.UNIFORM
                            },
                        })

                        hashEntries.push(alpha)

                        return {
                            entries,
                            material: prim.material,
                            hashEntries,
                            primitiveId: prim.id
                        }
                    })
                }
            }).flat(),
            usedTextureUvIndices: usedTextureUvIndices
        }
    }


    private entryCreator(
        sceneObjects: SceneObject[],
        callFrom: callFrom | undefined = undefined,
        codes: string[],
        getExtra: ((material: Material) => {
            texture: {
                data: TypedArray,
                size: vec2,
                usedUv: number
            } | null,
            factor: number[] | number,
        }) | undefined = undefined,
        type: 'ExtensionTexture' | "JustTexture" = "JustTexture",
    ): SmartRenderInitEntryPassType {
        let groups: any;
        let usedTextureUvIndices: any;
        if (type === "JustTexture" && callFrom) {

            const {
                groups: materialGroups,
                usedTextureUvIndices: materialUsedTextureUvIndices
            } = this.getMaterialBindGroups(sceneObjects, callFrom, getExtra)
            groups = materialGroups;
            usedTextureUvIndices = materialUsedTextureUvIndices;
        } else if (getExtra) {

            const {
                groups: materialGroups,
                usedTextureUvIndices: materialUsedTextureUvIndices
            } = this.getExtensionMaterialBindGroups(sceneObjects, getExtra)
            groups = materialGroups;
            usedTextureUvIndices = materialUsedTextureUvIndices;
        }
        const pipelineDescriptors = this.getPipelineDescriptors(sceneObjects, usedTextureUvIndices)
        const geometryBindGroup = this.getGeometryBindGroups(sceneObjects)

        const codeMap: Map<"withBone" | "withUv" | "withUvAndBone" | "withoutUvAndBone", ShaderCodeEntry> = new Map()
        vertexShaderCodes.forEach((value, key) => {
            if (key === "withUv" || key === "withUvAndBone") {
                codeMap.set(key, {
                    code: value + '\n' + codes[0],
                    primitivesId: []
                })
            } else {
                codeMap.set(key, {
                    code: value + '\n' + codes[1],
                    primitivesId: []
                })
            }
        })

        const materialLayoutWithIds: BindGroupEntryLayout = SmartRender.defaultMaterialBindGroupLayout.map((layout) => ({
            layoutsEntries: layout,
            primitivesId: []
        }))

        const geometryLayoutWithIds: BindGroupEntryLayout = SmartRender.defaultGeometryBindGroupLayout.map((layout) => ({
            layoutsEntries: layout,
            primitivesId: []
        }))
        sceneObjects.forEach((sceneObject) => {
            if (sceneObject.mesh && sceneObject.primitivesData && sceneObject.primitivesData.length > 0) {
                sceneObject.primitivesData.forEach((prim) => {
                    const extra = getExtra ? getExtra(prim.material) : undefined
                    if ((callFrom && prim.material[callFrom.texture]()) || (extra?.texture)) {
                        materialLayoutWithIds[0].primitivesId.push(prim.id)
                    } else {
                        materialLayoutWithIds[1].primitivesId.push(prim.id)
                    }
                    geometryLayoutWithIds[0].primitivesId.push(prim.id)

                    if ((callFrom && prim.material[callFrom.texture]()) || extra?.texture) {
                        const data = codeMap.get("withUv");
                        data?.primitivesId.push(prim.id)
                        codeMap.set("withUv", data as any)
                    } else {
                        const data = codeMap.get("withoutUvAndBone");
                        data?.primitivesId.push(prim.id)
                        codeMap.set("withoutUvAndBone", data as any)
                    }
                })
            }
        })
        const shaderCodes: ShaderCodeEntry[] = [];
        codeMap.forEach((value) => {
            if (value.primitivesId.length > 0) {
                shaderCodes.push(value)
            }
        })
        return {
            materialBindGroupLayout: materialLayoutWithIds,
            materialBindGroup: groups,
            geometryBindGroupLayout: geometryLayoutWithIds,
            pipelineDescriptors,
            shaderCodes,
            geometryBindGroups: geometryBindGroup.geometryBindGroupData,
        }
    }

    private getRenderAbleNodes(sceneObjects: Set<SceneObject>) {
        const renderAbleNodes: SceneObject[] = []
        sceneObjects.forEach(sceneObject => {
            if (sceneObject.mesh && sceneObject.primitivesData && sceneObject.primitivesData?.length > 0) {
                renderAbleNodes.push(sceneObject)
            }
        })

        return renderAbleNodes
    }

    public base(sceneObjects: Set<SceneObject>): SmartRenderInitEntryPassType {
        const renderAbleNodes = this.getRenderAbleNodes(sceneObjects)
        return this.entryCreator(renderAbleNodes, {
            texture: "getBaseColorTexture",
            factor: "getBaseColorFactor"
        }, baseColorFragment, undefined, "JustTexture")
    }

    public emissive(sceneObjects: Set<SceneObject>): SmartRenderInitEntryPassType {
        const renderAbleNodes = this.getRenderAbleNodes(sceneObjects)
        return this.entryCreator(renderAbleNodes, {
            texture: "getEmissiveTexture",
            factor: "getEmissiveFactor"
        }, emissiveFragments, (material) => {
            const emissiveExtension = material.getExtension<EmissiveStrength>("KHR_materials_emissive_strength")
            if (emissiveExtension) {
                return {
                    factor: [emissiveExtension.getEmissiveStrength()],
                    texture: null,
                }
            }
            return {
                factor: [1],
                texture: null,
            }
        }, "JustTexture")
    }

    public opacity(sceneObjects: Set<SceneObject>): SmartRenderInitEntryPassType {
        const renderAbleNodes = this.getRenderAbleNodes(sceneObjects)
        return this.entryCreator(renderAbleNodes, {
            texture: "getBaseColorTexture",
            factor: "getBaseColorFactor"
        }, opacityFragments, undefined, "JustTexture")
    }

    public occlusion(sceneObjects: Set<SceneObject>): SmartRenderInitEntryPassType {
        const renderAbleNodes = this.getRenderAbleNodes(sceneObjects)
        return this.entryCreator(renderAbleNodes, {
            texture: "getOcclusionTexture",
            factor: "getOcclusionStrength"
        }, occlusionFragments, undefined, "JustTexture")
    }

    public normal(sceneObjects: Set<SceneObject>): SmartRenderInitEntryPassType {
        const renderAbleNodes = this.getRenderAbleNodes(sceneObjects)
        return this.entryCreator(renderAbleNodes, {
            texture: "getNormalTexture",
            factor: "getNormalScale"
        }, normalFragments, undefined, "JustTexture")
    }

    public metallic(sceneObjects: Set<SceneObject>): SmartRenderInitEntryPassType {
        const renderAbleNodes = this.getRenderAbleNodes(sceneObjects)
        return this.entryCreator(renderAbleNodes, {
            texture: "getMetallicRoughnessTexture",
            factor: "getMetallicFactor"
        }, metallicFragments, undefined, "JustTexture")
    }

    public roughness(sceneObjects: Set<SceneObject>): SmartRenderInitEntryPassType {
        const renderAbleNodes = this.getRenderAbleNodes(sceneObjects)
        return this.entryCreator(renderAbleNodes, {
            texture: "getMetallicRoughnessTexture",
            factor: "getRoughnessFactor"
        }, roughnessFragments, undefined, "JustTexture")
    }

    public transmission(sceneObjects: Set<SceneObject>): SmartRenderInitEntryPassType {
        const renderAbleNodes = this.getRenderAbleNodes(sceneObjects)
        return this.entryCreator(renderAbleNodes, undefined, transmissionFragments, (material) => {
            const transmission = material.getExtension<Transmission>('KHR_materials_transmission')
            if (transmission) {
                const texture = transmission.getTransmissionTexture()
                const textureInfo = transmission.getTransmissionTextureInfo()
                return {
                    texture: texture ? {
                        data: texture.getImage() as Uint8Array,
                        usedUv: textureInfo?.getTexCoord() as number,
                        size: texture.getSize() as vec2
                    } : null,
                    factor: transmission.getTransmissionFactor()
                }
            }

            return {
                texture: null,
                factor: 0
            }
        }, "JustTexture")
    }

    public specular(sceneObjects: Set<SceneObject>): SmartRenderInitEntryPassType {
        const renderAbleNodes = this.getRenderAbleNodes(sceneObjects)
        return this.entryCreator(renderAbleNodes, undefined, specularFragments, (material) => {
            const specular = material.getExtension<Specular>("KHR_materials_specular")
            if (specular) {
                const texture = specular.getSpecularTexture()
                const textureInfo = specular.getSpecularTextureInfo()
                return {
                    texture: texture ? {
                        data: texture.getImage() as Uint8Array,
                        usedUv: textureInfo?.getTexCoord() as number,
                        size: texture.getSize() as vec2
                    } : null,
                    factor: specular.getSpecularFactor()
                }
            }

            return {
                texture: null,
                factor: 0
            }
        }, "JustTexture")
    }

    public clearcoat(sceneObjects: Set<SceneObject>): SmartRenderInitEntryPassType {
        const renderAbleNodes = this.getRenderAbleNodes(sceneObjects)
        return this.entryCreator(renderAbleNodes, undefined, clearcoatFragments, (material) => {
            const clearcoat = material.getExtension<Clearcoat>("KHR_materials_clearcoat")
            if (clearcoat) {
                const texture = clearcoat.getClearcoatTexture()
                const textureInfo = clearcoat.getClearcoatTextureInfo()
                return {
                    texture: texture ? {
                        data: texture.getImage() as Uint8Array,
                        usedUv: textureInfo?.getTexCoord() as number,
                        size: texture.getSize() as vec2
                    } : null,
                    factor: clearcoat.getClearcoatFactor()
                }
            }

            return {
                texture: null,
                factor: 0
            }
        }, "JustTexture")
    }

}