import {BaseLayer, RenderAblePrim} from "../layers/baseLayer.ts";
import {GeometryData} from "../scene/loader/loaderTypes.ts";
import {Material, Root, TypedArray} from "@gltf-transform/core";
import {hashCreationBindGroupEntry, HashGenerator} from "../scene/GPURenderSystem/Hasher/HashGenerator.ts";
import {GPUCache} from "../scene/GPURenderSystem/GPUCache/GPUCache.ts";
import {BindGroupEntryCreationType, RenderState} from "../scene/GPURenderSystem/GPUCache/GPUCacheTypes.ts";
import {SceneObject} from "../scene/sceneObject/sceneObject.ts";
import {createGPUBuffer} from "../helpers/global.helper.ts";
import {SmartRender} from "../scene/GPURenderSystem/SmartRender/SmartRender.ts";
import {ComputeManager} from "../scene/computation/computeManager.ts";


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
    sceneObject: SceneObject,
    side?: "front" | "back"
}[]
export type GeometryBindGroupEntry = {
    entries: (GPUBindGroupEntry & { name?: "model" | "normal", })[],
    primitivesId: number[],
}[]

export type SmartRenderInitEntryPassType = {
    materialBindGroupLayout: BindGroupEntryLayout,
    geometryBindGroupLayout: BindGroupEntryLayout,
    pipelineDescriptors: PipelineEntry,
    geometryBindGroups: GeometryBindGroupEntry,
    materialBindGroup: MaterialBindGroupEntry[],
    shaderCodes: ShaderCodeEntry[],
}

type initEntry = SmartRenderInitEntryPassType
type PipelineLayoutHashItem = {
    primitivePipelineDescriptor: RenderState
    primitiveId: number
    prim: GeometryData
    sceneObject: SceneObject
    side?: "front" | "back",
    hash: number
}
type modelRendererEntry = {
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    ctx: GPUCanvasContext,
    hasher: HashGenerator,
    gpuCache: GPUCache,
    smartRenderer: SmartRender
    computeManager: ComputeManager
}

type RenderMethod = "base" | "opacity";

export class ModelRenderer extends BaseLayer {
    private root!: Root;
    private smartRenderer!: SmartRender;
    private hasher: HashGenerator;
    private computeManager!: ComputeManager;
    private gpuCache: GPUCache;
    private initEntry!: initEntry;
    private sceneObjects: Set<SceneObject> = new Set();

    constructor({device, canvas, ctx, smartRenderer, hasher, gpuCache, computeManager}: modelRendererEntry) {
        super(device, canvas, ctx);
        this.hasher = hasher;
        this.smartRenderer = smartRenderer;
        this.gpuCache = gpuCache;
        this.computeManager = computeManager;
    }

    public fillInitEntry(T: initEntry | RenderMethod) {
        if (typeof T === "string") {
            if (!this.smartRenderer) throw new Error("SmartRenderer is not set");
            if (!this.sceneObjects) throw new Error("sceneObjects is not set");
            this.initEntry = this.smartRenderer[T](this.sceneObjects)
        } else {
            this.initEntry = T
        }
    }

    public setSceneObjects(sceneObjects: Set<SceneObject>) {
        this.sceneObjects = sceneObjects;
    }

    public setRoot(root: Root) {
        this.root = root;
    }

    public setLodThreshold(threshold: number) {
        if (!this.sceneObjects) throw new Error("sceneObjects is not set");
        this.sceneObjects.forEach(sceneObject => {
            sceneObject.setLodSelectionThreshold(threshold);
            this.computeManager.setLodSelection(sceneObject)
        })
    }


    private createLayoutHashes(layouts: BindGroupEntryLayout) {
        const layoutHashes = new Map<number, number>();
        layouts.forEach((item) => {
            const hash = this.hasher.hashBindGroupLayout(item.layoutsEntries)
            this.gpuCache.appendBindGroupLayout(item.layoutsEntries, hash)

            item.primitivesId.forEach((primitiveId) => {
                layoutHashes.set(primitiveId, hash)
            })
        })

        return layoutHashes
    }

    private async createMaterialBindGroupHashes(materialBindGroup: MaterialBindGroupEntry[], materialLayoutHashes: Map<number, number>) {
        const materialBindGroupHashes = new Map<number, number>();

        for (let i = 0; i < materialBindGroup.length; i++) {

            const materialItem = materialBindGroup[i];
            const hash = await this.hasher.hashBindGroup(materialItem.hashEntries);
            let materialLayout = materialLayoutHashes.get(materialItem.primitiveId)
            materialBindGroupHashes.set(materialItem.primitiveId, hash)
            if (!this.root) throw new Error("root is not set")
            await this.gpuCache.appendMaterialBindGroup(
                materialItem.entries,
                hash,
                materialLayout as number,
                materialItem.material,
                this.root.listExtensionsUsed()
            );

        }

        return materialBindGroupHashes
    }

    private createShaderCodeHashes(shaderCodes: ShaderCodeEntry[],) {
        const shaderCodesHashes = new Map<number, number>();
        for (let i = 0; i < shaderCodes.length; i++) {
            const item = shaderCodes[i];
            const hash = this.hasher.hashShaderModule(item.code)

            item.primitivesId.forEach((primitiveId) => {
                shaderCodesHashes.set(primitiveId, hash)
            })
            this.gpuCache.appendShaderModule(item.code, hash)
        }

        return shaderCodesHashes
    }

    private createPipelineLayoutHashes(pipelineDescriptors: PipelineEntry, materialLayoutHashes: Map<number, number>, geometryLayoutHashes: Map<number, number>) {
        const pipelineLayoutsHashes = new Map<string, PipelineLayoutHashItem>();

        for (let i = 0; i < pipelineDescriptors.length; i++) {
            const item = pipelineDescriptors[i];

            let materialLayout = materialLayoutHashes.get(item.primitiveId)
            let geometryLayout = geometryLayoutHashes.get(item.primitiveId)

            const hash = this.hasher.hashPipelineLayout(
                materialLayout as number,
                geometryLayout as number
            )
            this.gpuCache.appendPipelineLayout(
                hash,
                materialLayout as number,
                geometryLayout as number
            )
            pipelineLayoutsHashes.set(`${item.primitiveId}_${item.side ?? "none"}`, {
                ...item,
                hash
            });
        }

        return pipelineLayoutsHashes
    }

    private createPipelineHashes(shaderCodesHashes: Map<number, number>, pipelineLayoutsHashes: Map<string, PipelineLayoutHashItem>) {
        const pipelineHashes = new Map<string, number>();
        pipelineLayoutsHashes.forEach((item) => {
            const shaderCodeHash = shaderCodesHashes.get(item.primitiveId) as number
            const hash = this.hasher.hashPipeline(item.primitivePipelineDescriptor, item.hash)
            this.gpuCache.appendPipeline(item.primitivePipelineDescriptor, hash, item.hash, shaderCodeHash as number)
            pipelineHashes.set(`${item.primitiveId}_${item.side ?? "none"}`, hash)
        })
        return pipelineHashes
    }

    private createGeometryBindGroupMaps(geometryBindGroups: GeometryBindGroupEntry) {
        const geometryBindGroupMaps = new Map<number, (GPUBindGroupEntry & {
            name?: "model" | "normal"
        })[]>();
        geometryBindGroups.forEach((item) => {

            item.primitivesId.forEach((primitiveId) => {
                geometryBindGroupMaps.set(primitiveId, item.entries)
            })
        })

        return geometryBindGroupMaps
    }

    public async init() {
        if (!this.initEntry) throw new Error("init entry is not filled")
        const {
            materialBindGroupLayout,
            geometryBindGroupLayout,
            geometryBindGroups,
            materialBindGroup,
            pipelineDescriptors,
            shaderCodes,
        } = this.initEntry

        const materialLayoutHashes = this.createLayoutHashes(materialBindGroupLayout)
        const geometryLayoutHashes = this.createLayoutHashes(geometryBindGroupLayout)
        const materialBindGroupHashes = await this.createMaterialBindGroupHashes(materialBindGroup, materialLayoutHashes)
        const shaderCodesHashes = this.createShaderCodeHashes(shaderCodes)
        const pipelineLayoutsHashes = this.createPipelineLayoutHashes(pipelineDescriptors, materialLayoutHashes, geometryLayoutHashes)
        const pipelineHashes = this.createPipelineHashes(shaderCodesHashes, pipelineLayoutsHashes)
        const geometryBindGroupMaps = this.createGeometryBindGroupMaps(geometryBindGroups)
        const sceneObjects: Map<number, SceneObject> = new Map();

        pipelineHashes.forEach((pipelineHash, key) => {
            const primitiveId = +(key.split("_")[0]);
            const geometryEntries = geometryBindGroupMaps.get(primitiveId)
            const geometryLayoutHash = geometryLayoutHashes.get(primitiveId) as number
            const materialLayoutHash = materialLayoutHashes.get(primitiveId) as number

            const shaderCodeHash = shaderCodesHashes.get(primitiveId) as number

            const pipelineLayout = pipelineLayoutsHashes.get(key)
            const prim = pipelineLayout?.prim as GeometryData
            const side = pipelineLayout?.side as "back" | "front"
            const geometryBindGroup = BaseLayer.device.createBindGroup({
                entries: geometryEntries as any,
                layout: this.gpuCache.getGeometryLayout(geometryLayoutHash)
            })
            let materialBindGroupHash = materialBindGroupHashes.get(primitiveId) as number


            const renderSetup = this.gpuCache.getRenderSetup(
                pipelineHash,
                pipelineLayout?.hash as number,
                materialBindGroupHash,
                materialLayoutHash,
                geometryLayoutHash,
                shaderCodeHash
            )
            let primitive: RenderAblePrim = {
                pipeline: renderSetup.pipeline,
                bindGroups: [ModelRenderer.globalBindGroup.bindGroup, renderSetup.materialBindGroup, geometryBindGroup],
                vertexBuffers: [],
                lodRanges: prim.lodRanges,
                id: prim.id,
                side: side,
                indexData: prim.indices
            }

            pipelineLayout?.primitivePipelineDescriptor.buffers.forEach((item) => {
                primitive.vertexBuffers.push(createGPUBuffer(BaseLayer.device, pipelineLayout.prim.dataList.get(item.name)?.array as TypedArray, GPUBufferUsage.VERTEX, `${pipelineLayout.sceneObject.name}  ${item.name}`))
            })
            pipelineLayout?.sceneObject.appendPrimitive(primitive)
            sceneObjects.set((pipelineLayout as any).sceneObject.id, (pipelineLayout as any).sceneObject)
            if (prim.indices) {
                this.computeManager.setIndex(pipelineLayout?.sceneObject as SceneObject)
            }
            this.computeManager.setIndirect(pipelineLayout?.sceneObject as SceneObject)
        })
        sceneObjects.forEach(sceneObject => {
            ModelRenderer.appendDrawCall = sceneObject
        })
    }
}