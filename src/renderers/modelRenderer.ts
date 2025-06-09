import {BaseLayer, RenderAble} from "../layers/baseLayer.ts";
import {createGPUBuffer} from "../helpers/global.helper.ts";
import {ComputeFrustumCulling} from "../scene/computeFrustumCulling.ts";
import {GeometryData, LODRange, MeshData} from "../scene/loader/loaderTypes.ts";
import {Material, Root, TypedArray} from "@gltf-transform/core";
import {hashCreationBindGroupEntry, HashGenerator} from "../scene/GPURenderSystem/Hasher/HashGenerator.ts";
import {GPUCache} from "../scene/GPURenderSystem/GPUCache/GPUCache.ts";
import {BindGroupEntryCreationType, RenderState} from "../scene/GPURenderSystem/GPUCache/GPUCacheTypes.ts";

export type Lod = {
    defaultLod: number
    applyBaseVertex: boolean
} | undefined

export type ComputeShader = {
    lod: {
        threshold: number
        applyBaseVertex: boolean
    }
} | undefined

export type ShaderCodeEntry = { code: string, primitivesId: number[] }
export type MaterialBindGroupEntry = {
    hashEntries: hashCreationBindGroupEntry,
    entries: BindGroupEntryCreationType[],
    material: Material,
    primitiveId: number
}
export type BindGroupEntryLayout = {
    layoutsEntries: GPUBindGroupLayoutEntry[],
    primitivesId: number[]
}[]
export type PipelineEntry = {
    primitivePipelineDescriptor: RenderState,
    primitiveId: number, prim: GeometryData,
    type: "opaque" | "transparent"
    mesh: MeshData
}[]
export type GeometryBindGroupEntry = {
    entries: (GPUBindGroupEntry & { name?: "model" | "normal", })[],
    mesh: MeshData,
    primitivesId: number[],
    indexOnMeshes: number
}[]

export type SmartRenderInitEntryPassType = {
    materialBindGroupLayout: BindGroupEntryLayout,
    geometryBindGroupLayout: BindGroupEntryLayout,
    pipelineDescriptors: PipelineEntry,
    geometryBindGroups: GeometryBindGroupEntry,
    materialBindGroup: MaterialBindGroupEntry[],
    shaderCodes: ShaderCodeEntry[],
    skeletonBuffers: Map<number, GPUBuffer>
}

type initEntry = {
    lod?: Lod,
    computeShader?: ComputeShader,
} & SmartRenderInitEntryPassType

type modelRendererEntry = {
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    ctx: GPUCanvasContext,
    root: Root,
    boundingComputer: ComputeFrustumCulling,
    hasher: HashGenerator,
    gpuCache: GPUCache,
}

export class ModelRenderer extends BaseLayer {
    private ComputeBoundingSphere: ComputeFrustumCulling;
    private root: Root;
    private hasher: HashGenerator;
    private gpuCache: GPUCache;

    constructor({device, canvas, ctx, root, hasher, gpuCache, boundingComputer}: modelRendererEntry) {
        super(device, canvas, ctx);
        this.ComputeBoundingSphere = boundingComputer;
        this.root = root;
        this.hasher = hasher;
        this.gpuCache = gpuCache;
    }


    public async init(
        {
            computeShader,
            lod,
            geometryBindGroups,
            materialBindGroup,
            geometryBindGroupLayout,
            pipelineDescriptors,
            materialBindGroupLayout,
            shaderCodes,
        }: initEntry
    ) {

        const materialLayoutHashes = materialBindGroupLayout.map((item) => {
            const hash = this.hasher.hashBindGroupLayout(item.layoutsEntries);
            this.gpuCache.appendBindGroupLayout(item.layoutsEntries, hash)

            return {
                hash,
                primitivesId: item.primitivesId
            }
        })
        const geometryLayoutHashes = geometryBindGroupLayout.map((item) => {
            const hash = this.hasher.hashBindGroupLayout(item.layoutsEntries);
            this.gpuCache.appendBindGroupLayout(item.layoutsEntries, hash)
            return {
                hash,
                primitivesId: item.primitivesId
            }
        })
        const materialBindGroupHashes: {
            hash: number,
            primitiveId: number
        }[] = [];
        for (let i = 0; i < materialBindGroup.length; i++) {

            const materialItem = materialBindGroup[i];

            const hash = await this.hasher.hashBindGroup(materialItem.hashEntries);
            let materialLayout = materialLayoutHashes.find((layout) => layout.primitivesId.find(id => materialItem.primitiveId === id));
            materialBindGroupHashes[i] = {
                hash,
                primitiveId: materialItem.primitiveId
            };
            await this.gpuCache.appendMaterialBindGroup(
                materialItem.entries,
                hash,
                materialLayout?.hash as number,
                materialItem.material,
                this.root.listExtensionsUsed()
            );

        }

        const shaderCodesHashes: { hash: number, primitivesId: number[] }[] = [];
        for (let i = 0; i < shaderCodes.length; i++) {
            const item = shaderCodes[i];
            const hash = await this.hasher.hashShaderModule(item.code)
            shaderCodesHashes[i] = {
                hash,
                primitivesId: item.primitivesId
            };
            this.gpuCache.appendShaderModule(item.code, hash)
        }

        const pipelineLayoutsHashes: {
            mesh: MeshData,
            pipelineLayout: ({
                hash: number,
                materialLayoutHash: number,
                geometryLayoutHash: number,
                buffers: (GPUVertexBufferLayout & {
                    name: string
                })[]
            } & RenderState),
            prim: GeometryData,
            primitiveId: number,
            type: "opaque" | "transparent"
        }[] = [];
        for (let i = 0; i < pipelineDescriptors.length; i++) {
            const item = pipelineDescriptors[i];

            let materialLayout = materialLayoutHashes.find((layout) => layout.primitivesId.find(id => item.primitiveId === id));
            let geometryLayout = geometryLayoutHashes.find((layout) => layout.primitivesId.find(id => item.primitiveId === id));

            const hash = this.hasher.hashPipelineLayout(
                materialLayout?.hash as number,
                geometryLayout?.hash as number
            )
            this.gpuCache.appendPipelineLayout(
                hash,
                materialLayout?.hash as number,
                geometryLayout?.hash as number
            )
            pipelineLayoutsHashes.push({
                pipelineLayout: {
                    ...item.primitivePipelineDescriptor,
                    hash,
                    materialLayoutHash: materialLayout?.hash as number,
                    geometryLayoutHash: geometryLayout?.hash as number,
                },
                mesh: item.mesh,
                prim: item.prim,
                primitiveId: item.primitiveId,
                type: item.type
            })
        }
        const pipelineHashes = pipelineLayoutsHashes.map((item) => {
            const shaderCodeHash = shaderCodesHashes.find((code) => code.primitivesId.find(id => item.primitiveId === id));
            const hash = this.hasher.hashPipeline(item.pipelineLayout, item.pipelineLayout.hash)
            this.gpuCache.appendPipeline(item.pipelineLayout, hash, item.pipelineLayout.hash, shaderCodeHash?.hash as number)
            return {
                mesh: item.mesh,
                primitivePipeline: {
                    hash: hash,
                    primitiveId: item.primitiveId,
                    layoutHash: item.pipelineLayout.hash,
                    materialLayoutHash: item.pipelineLayout.materialLayoutHash,
                    geometryLayoutHash: item.pipelineLayout.geometryLayoutHash,
                    shaderCodeHash: shaderCodeHash?.hash as number,
                    prim: item.prim,
                    buffers: item.pipelineLayout.buffers,
                    primitiveRenderState: item.pipelineLayout.primitive,
                    type: item.type
                }
            }
        })


        pipelineHashes.forEach(({mesh, primitivePipeline}) => {
            const geometryEntries = geometryBindGroups.find(item => item.primitivesId.includes(primitivePipeline.primitiveId))

            const geometryBindGroup = this.device.createBindGroup({
                entries: geometryEntries?.entries as any,
                layout: this.gpuCache.getGeometryLayout(primitivePipeline.geometryLayoutHash)
            })

            let materialBindGroupHash = materialBindGroupHashes.find((bindGroup) => primitivePipeline.primitiveId === bindGroup.primitiveId);
            const renderSetup = this.gpuCache.getRenderSetup(
                primitivePipeline.hash,
                primitivePipeline.layoutHash,
                materialBindGroupHash?.hash as number,
                primitivePipeline.materialLayoutHash,
                primitivePipeline.geometryLayoutHash,
                primitivePipeline.shaderCodeHash
            )

            let renderAble: RenderAble = {
                mesh,
                primitive: {
                    pipeline: renderSetup.pipeline,
                    bindGroups: [ModelRenderer.globalBindGroup.bindGroup, renderSetup.materialBindGroup, geometryBindGroup],
                    vertexBuffers: [],
                    index: null,
                    lodRanges: primitivePipeline.prim.lodRanges,
                },
                renderData: {
                    name: mesh.nodeName,
                    model: {
                        buffer: (geometryEntries?.entries.find(item => item.name === "model") as any).resource.buffer as GPUBuffer,
                        data: mesh.localMatrix
                    },
                    normal: geometryEntries?.entries.find(item => item.name === "normal") ? {
                        buffer: (geometryEntries?.entries.find(item => item.name === "normal") as any).resource.buffer,
                        data: mesh.normalMatrix
                    } : undefined
                },
                computeShader: computeShader ? {
                    frustumCulling: {
                        min: [0, 0, 0],
                        max: [0, 0, 0]
                    },
                    lod: {
                        ...computeShader.lod
                    }
                } : undefined,
            }


            primitivePipeline.buffers.forEach((item) => {
                renderAble.primitive.vertexBuffers.push(createGPUBuffer(this.device, primitivePipeline.prim.dataList[item.name]?.array as TypedArray, GPUBufferUsage.VERTEX, `${mesh.nodeName}  ${item.name}`))
            })

            if (primitivePipeline.prim.indexType !== "Unknown" && primitivePipeline.prim.indices) {

                renderAble.primitive.index = {
                    buffer: createGPUBuffer(this.device, primitivePipeline.prim.indices, GPUBufferUsage.INDEX, "index buffer"),
                    type: primitivePipeline.prim.indexType as "uint16" | "uint32"
                }
                renderAble.primitive.indirect = {
                    indirectBuffer: createGPUBuffer(this.device, new Uint32Array([
                        lod ? (primitivePipeline.prim.lodRanges as LODRange[])[lod.defaultLod].count : primitivePipeline.prim.indexCount,
                        1,
                        lod ? (primitivePipeline.prim.lodRanges as LODRange[])[lod.defaultLod].start : 0,
                        lod && lod.applyBaseVertex ? (primitivePipeline.prim.lodRanges as LODRange[])[lod.defaultLod].baseVertex : 0,
                        0
                    ]), GPUBufferUsage.INDIRECT, `${mesh.nodeName}  indirect buffer`),
                    indirectOffset: 0
                }
            } else {

                renderAble.primitive.indirect = {
                    indirectBuffer: createGPUBuffer(this.device, new Uint32Array([
                        primitivePipeline.prim.indexCount,
                        1,
                        0,
                        0,
                        0
                    ]), GPUBufferUsage.INDIRECT, `${mesh.nodeName} indirect buffer`),
                    indirectOffset: 0
                }
            }

            if (computeShader) {
                this.ComputeBoundingSphere.appendToQueue(mesh, (T) => {
                    if (renderAble?.computeShader) {
                        renderAble.computeShader.frustumCulling = {
                            min: T.min,
                            max: T.max,
                        }
                    }
                }, mesh.localMatrix)

            }

            if (primitivePipeline.type === "opaque") {
                BaseLayer.appendRenderAble({renderAble, where: primitivePipeline.type})
            } else {
                BaseLayer.appendRenderAble({
                    renderAble: {
                        ...renderAble,
                        side: primitivePipeline.primitiveRenderState.cullMode as any
                    }, where: primitivePipeline.type
                })
            }
        })
    }
}