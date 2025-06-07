import {BindGroupEntryCreationType} from "../GPUCache/GPUCacheTypes.ts";
import {hashCreationBindGroupEntry} from "../Hasher/HashGenerator.ts";
import {convertAlphaMode, createGPUBuffer, getTextureFromData} from "../../../helpers/global.helper.ts";
import {Material, Texture, TypedArray, vec2} from "@gltf-transform/core";
import {MeshData} from "../../loader/loaderTypes.ts";
import {Clearcoat, EmissiveStrength, Specular, Transmission} from "@gltf-transform/extensions";
import {
    baseColorCodes, clearcoatCodes,
    emissiveCodes,
    metallicCodes,
    normalCodes,
    occlusionCodes,
    opacityCodes, roughnessCodes, specularCodes, transmissionCodes
} from "./shaderCodes.ts";
import {
    MaterialBindGroupEntry, BindGroupEntryLayout,
    ShaderCodeEntry,
    SmartRenderInitEntryPassType, PipelineEntry, GeometryBindGroupEntry
} from "../../../renderers/modelRenderer.ts";


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

    private getGeometryBindGroups(meshes: MeshData[]): GeometryBindGroupEntry {
        return meshes.map((mesh, i) => {
            return {
                indexOnMeshes: i,
                entries: [
                    {
                        binding: 0,
                        resource: {
                            buffer: createGPUBuffer(SmartRender.device, mesh.localMatrix, GPUBufferUsage.UNIFORM, `model matrix buffer ${mesh.nodeName}`)
                        },
                        name: "model"
                    },
                ] as (GPUBindGroupEntry & { name: "model" | "normal" })[],
                mesh,
                primitivesId: mesh.geometry.map(prim => prim.id)
            }
        })
    }

    private getMaterialBindGroups(
        meshes: MeshData[],
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
            groups: meshes.map((mesh) => mesh.geometry.map((prim, i): MaterialBindGroupEntry => {
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
                        label: `${mesh.nodeName} factors at prim : ${i}`,
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
                        label: `${mesh.nodeName} alphaMode at prim : ${i}`,
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
            })).flat(),
            usedTextureUvIndices: usedTextureUvIndices
        }
    }

    private getPipelineDescriptors(meshes: MeshData[], usedTextureUvIndices: number[]): PipelineEntry {
        const output: PipelineEntry = []
        meshes.forEach((mesh) => {

            mesh.geometry.forEach((prim, i) => {
                const buffers: (GPUVertexBufferLayout & { name: string; })[] = [{
                    arrayStride: 3 * 4,
                    attributes: [{
                        offset: 0,
                        shaderLocation: 0,
                        format: "float32x3"
                    }],
                    name: 'POSITION'
                }]

                if (prim.dataList[`TEXCOORD_${usedTextureUvIndices[i]}`]) {
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
                        mesh,
                        primitiveId: prim.id,
                        prim,
                        type: "transparent",
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
                        mesh,
                        primitiveId: prim.id,
                        prim,
                        type: "transparent",
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
                        mesh,
                        primitiveId: prim.id,
                        prim,
                        type: "opaque",
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
        })

        return output
    }

    private getExtensionMaterialBindGroups(
        meshes: MeshData[],
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
            groups: meshes.map(mesh => mesh.geometry.map((prim, i) => {
                const entries: BindGroupEntryCreationType[] = []
                const hashEntries: hashCreationBindGroupEntry = []
                const extra = getExtra(prim.material);
                const factorsTypedArray = new Float32Array([...[extra.factor].flat()]);

                entries.push({
                    bindingPoint: 0,
                    typedArray: {
                        conversion: createGPUBuffer,
                        usage: GPUBufferUsage.UNIFORM,
                        label: `${mesh.nodeName} factors at prim : ${i}`,
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
                        label: `${mesh.nodeName} alphaMode at prim : ${i}`,
                        usage: GPUBufferUsage.UNIFORM
                    },
                })

                hashEntries.push(alpha)

                return {
                    entries,
                    material: prim.material,
                    hashEntries
                }
            })).flat(),
            usedTextureUvIndices: usedTextureUvIndices
        }
    }


    private entryCreator(
        meshes: MeshData[],
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
        type: 'ExtensionTexture' | "JustTexture" = "JustTexture"
    ): SmartRenderInitEntryPassType {
        let groups: any;
        let usedTextureUvIndices: any;
        if (type === "JustTexture" && callFrom) {

            const {
                groups: materialGroups,
                usedTextureUvIndices: materialUsedTextureUvIndices
            } = this.getMaterialBindGroups(meshes, callFrom, getExtra)
            groups = materialGroups;
            usedTextureUvIndices = materialUsedTextureUvIndices;
        } else if (getExtra) {

            const {
                groups: materialGroups,
                usedTextureUvIndices: materialUsedTextureUvIndices
            } = this.getExtensionMaterialBindGroups(meshes, getExtra)
            groups = materialGroups;
            usedTextureUvIndices = materialUsedTextureUvIndices;
        }
        const pipelineDescriptors = this.getPipelineDescriptors(meshes, usedTextureUvIndices)
        const geometryBindGroup = this.getGeometryBindGroups(meshes)

        const codesWithIdArrays: ShaderCodeEntry[] = codes.map((code) => ({
            code,
            primitivesId: []
        }))
        const materialLayoutWithIds: BindGroupEntryLayout = SmartRender.defaultMaterialBindGroupLayout.map((layout) => ({
            layoutsEntries: layout,
            primitivesId: []
        }))
        const geometryLayoutWithIds: BindGroupEntryLayout = SmartRender.defaultGeometryBindGroupLayout.map((layout) => ({
            layoutsEntries: layout,
            primitivesId: []
        }))

        meshes.map((mesh) => mesh.geometry.map((prim) => {
            const extra = getExtra ? getExtra(prim.material) : undefined
            if ((callFrom && prim.material[callFrom.texture]()) || (extra?.texture)) {
                codesWithIdArrays[0].primitivesId.push(prim.id)
                materialLayoutWithIds[0].primitivesId.push(prim.id)
            } else {
                codesWithIdArrays[1].primitivesId.push(prim.id)
                materialLayoutWithIds[1].primitivesId.push(prim.id)
            }
            geometryLayoutWithIds[0].primitivesId.push(prim.id)
        }))


        return {
            materialBindGroupLayout: materialLayoutWithIds,
            materialBindGroup: groups,
            geometryBindGroupLayout: geometryLayoutWithIds,
            pipelineDescriptors,
            shaderCodes: codesWithIdArrays,
            geometryBindGroups: geometryBindGroup
        }
    }

    public base(meshes: MeshData[]): SmartRenderInitEntryPassType {

        return this.entryCreator(meshes, {
            texture: "getBaseColorTexture",
            factor: "getBaseColorFactor"
        }, baseColorCodes)
    }

    public emissive(meshes: MeshData[]): SmartRenderInitEntryPassType {

        return this.entryCreator(meshes, {
            texture: "getEmissiveTexture",
            factor: "getEmissiveFactor"
        }, emissiveCodes, (material) => {
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
        })
    }

    public opacity(meshes: MeshData[]): SmartRenderInitEntryPassType {

        return this.entryCreator(meshes, {
            texture: "getBaseColorTexture",
            factor: "getBaseColorFactor"
        }, opacityCodes)
    }

    public occlusion(meshes: MeshData[]): SmartRenderInitEntryPassType {

        return this.entryCreator(meshes, {
            texture: "getOcclusionTexture",
            factor: "getOcclusionStrength"
        }, occlusionCodes)
    }

    public normal(meshes: MeshData[]): SmartRenderInitEntryPassType {

        return this.entryCreator(meshes, {
            texture: "getNormalTexture",
            factor: "getNormalScale"
        }, normalCodes)
    }

    public metallic(meshes: MeshData[]): SmartRenderInitEntryPassType {

        return this.entryCreator(meshes, {
            texture: "getMetallicRoughnessTexture",
            factor: "getMetallicFactor"
        }, metallicCodes)
    }

    public roughness(meshes: MeshData[]): SmartRenderInitEntryPassType {

        return this.entryCreator(meshes, {
            texture: "getMetallicRoughnessTexture",
            factor: "getRoughnessFactor"
        }, roughnessCodes)
    }

    public transmission(meshes: MeshData[]): SmartRenderInitEntryPassType {

        return this.entryCreator(meshes, undefined, transmissionCodes, (material) => {
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
        })
    }

    public specular(meshes: MeshData[]): SmartRenderInitEntryPassType {

        return this.entryCreator(meshes, undefined, specularCodes, (material) => {
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
        })
    }

    public clearcoat(meshes: MeshData[]): SmartRenderInitEntryPassType {

        return this.entryCreator(meshes, undefined, clearcoatCodes, (material) => {
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
        })
    }

}