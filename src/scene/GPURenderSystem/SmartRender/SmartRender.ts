import {BindGroupEntryCreationType, RenderState} from "../GPUCache/GPUCacheTypes.ts";
import {hashCreationBindGroupEntry} from "../Hasher/HashGenerator.ts";
import {convertAlphaMode, createGPUBuffer, getTextureFromData} from "../../../helpers/global.helper.ts";
import {Material, Texture, TypedArray, vec2} from "@gltf-transform/core";
import {MeshData} from "../../loader/loaderTypes.ts";
import {Clearcoat, EmissiveStrength, Specular, Transmission} from "@gltf-transform/extensions";
import {
    baseColorCodes, clearcoatCodes, clearcoatNormalCodes,
    emissiveCodes,
    metallicCodes,
    normalCodes,
    occlusionCodes,
    opacityCodes, roughnessCodes, specularCodes, transmissionCodes
} from "./shaderCodes.ts";

type outputType = {
    meshes: MeshData[],
    materialBindGroupLayout: { layoutsEntries: GPUBindGroupLayoutEntry[][], primitiveIndex: number[] },
    geometryBindGroupLayout: { entries: GPUBindGroupLayoutEntry[][], primitiveIndex: number[] },
    pipelineDescriptors: RenderState[],
    geometryBindGroup: {
        entries: (GPUBindGroupEntry & {
            name: "model" | "normal";
        })[], mesh: MeshData
    }[],
    materialBindGroup: {
        hashEntries: hashCreationBindGroupEntry,
        entries: BindGroupEntryCreationType[],
        material: Material
    }[],
    shaderCodes: { codes: string[], primitiveIndex: number[] },
}
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

    private getGeometryBindGroups(meshes: MeshData[]) {
        return meshes.map((mesh) => {
            return {
                entries: [
                    {
                        binding: 0,
                        resource: {
                            buffer: createGPUBuffer(SmartRender.device, mesh.localMatrix, GPUBufferUsage.UNIFORM, `model matrix buffer ${mesh.nodeName}`)
                        },
                        name: "model"
                    },
                ] as (GPUBindGroupEntry & { name: "model" | "normal" })[],
                mesh
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
            groups: meshes.map(mesh => mesh.geometry.map((prim, i) => {
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
                    hashEntries
                }
            })).flat(),
            usedTextureUvIndices: usedTextureUvIndices
        }
    }

    private getPipelineDescriptors(meshes: MeshData[], usedTextureUvIndices: number[]) {
        return meshes.map((mesh) => mesh.geometry.map((prim, i): RenderState => {
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

            return {
                primitive: {
                    cullMode: prim.material.getDoubleSided() ? "none" : "back",
                    frontFace: "ccw",
                },
                depthStencil: {
                    depthCompare: "less",
                    depthWriteEnabled: prim.material.getAlphaMode() !== "BLEND",
                    format: "depth24plus"
                },
                targets: [{
                    writeMask: GPUColorWrite.ALL,
                    blend: prim.material.getAlphaMode() === "BLEND" ? {
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
        })).flat()
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
    ): outputType {
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
        let onlyShow = -1;
        if (meshes.length === 1 && meshes[0].geometry.length === 1) {
            if (callFrom) {
                onlyShow = meshes[0].geometry[0].material[callFrom.texture]() ? 0 : 1
            } else if (getExtra) {
                const extra = getExtra(meshes[0].geometry[0].material)
                if (extra.texture) {
                    onlyShow = 0
                } else {
                    onlyShow = 1
                }
            }
        }
        return {
            meshes: meshes,
            materialBindGroupLayout: {
                layoutsEntries: SmartRender.defaultMaterialBindGroupLayout,
                primitiveIndex: meshes.map(mesh => mesh.geometry.map(prim => {
                    const extra = getExtra ? getExtra(prim.material) : undefined
                    if ((callFrom && prim.material[callFrom.texture]()) || (extra?.texture)) {
                        return 0
                    }
                    return 1
                })).flat()
            },
            materialBindGroup: groups,
            geometryBindGroupLayout: {
                entries: SmartRender.defaultGeometryBindGroupLayout,
                primitiveIndex: meshes.map(mesh => mesh.geometry.map(() => 0)).flat()
            },
            pipelineDescriptors,
            shaderCodes: {
                codes: onlyShow === -1 ? codes : [codes[onlyShow]],
                primitiveIndex: meshes.map((mesh) => mesh.geometry.map((prim) => {
                    if (onlyShow === -1) {
                        const extra = getExtra ? getExtra(prim.material) : undefined

                        if ((callFrom && prim.material[callFrom.texture]()) || (extra?.texture)) {
                            return 0
                        }
                        return 1
                    } else {
                        return 0
                    }

                })).flat()
            },
            geometryBindGroup: geometryBindGroup
        }
    }

    public base(meshes: MeshData[]): outputType {

        return this.entryCreator(meshes, {
            texture: "getBaseColorTexture",
            factor: "getBaseColorFactor"
        }, baseColorCodes)
    }

    public emissive(meshes: MeshData[]): outputType {

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

    public opacity(meshes: MeshData[]): outputType {

        return this.entryCreator(meshes, {
            texture: "getBaseColorTexture",
            factor: "getBaseColorFactor"
        }, opacityCodes)
    }

    public occlusion(meshes: MeshData[]): outputType {

        return this.entryCreator(meshes, {
            texture: "getOcclusionTexture",
            factor: "getOcclusionStrength"
        }, occlusionCodes)
    }

    public normal(meshes: MeshData[]): outputType {

        return this.entryCreator(meshes, {
            texture: "getNormalTexture",
            factor: "getNormalScale"
        }, normalCodes)
    }

    public metallic(meshes: MeshData[]): outputType {

        return this.entryCreator(meshes, {
            texture: "getMetallicRoughnessTexture",
            factor: "getMetallicFactor"
        }, metallicCodes)
    }

    public roughness(meshes: MeshData[]): outputType {

        return this.entryCreator(meshes, {
            texture: "getMetallicRoughnessTexture",
            factor: "getRoughnessFactor"
        }, roughnessCodes)
    }

    public transmission(meshes: MeshData[]): outputType {

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

    public specular(meshes: MeshData[]): outputType {

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

    public clearcoat(meshes: MeshData[]): outputType {

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

    public clearcoatNormal(meshes: MeshData[]): outputType {

        return this.entryCreator(meshes, undefined, clearcoatNormalCodes, (material) => {
            const clearcoatNormal = material.getExtension<Clearcoat>("KHR_materials_clearcoat")
            if (clearcoatNormal) {
                const texture = clearcoatNormal.getClearcoatNormalTexture()
                const textureInfo = clearcoatNormal.getClearcoatNormalTextureInfo()
                console.log(clearcoatNormal.getClearcoatNormalScale())
                return {
                    texture: texture ? {
                        data: texture.getImage() as Uint8Array,
                        usedUv: textureInfo?.getTexCoord() as number,
                        size: texture.getSize() as vec2
                    } : null,
                    factor: clearcoatNormal.getClearcoatNormalScale()
                }
            }

            return {
                texture: null,
                factor: 0
            }
        })
    }

    public clearcoatRoughness(meshes: MeshData[]): outputType {

        return this.entryCreator(meshes, undefined, clearcoatCodes, (material) => {
            const clearcoatRoughness = material.getExtension<Clearcoat>("KHR_materials_clearcoat")
            if (clearcoatRoughness) {
                const texture = clearcoatRoughness.getClearcoatRoughnessTexture()
                const textureInfo = clearcoatRoughness.getClearcoatRoughnessTextureInfo()

                return {
                    texture: texture ? {
                        data: texture.getImage() as Uint8Array,
                        usedUv: textureInfo?.getTexCoord() as number,
                        size: texture.getSize() as vec2
                    } : null,
                    factor: clearcoatRoughness.getClearcoatRoughnessFactor()
                }
            }

            return {
                texture: null,
                factor: 0
            }
        })
    }

}