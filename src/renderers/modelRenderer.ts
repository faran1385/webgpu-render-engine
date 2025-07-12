import {BaseLayer} from "../layers/baseLayer.ts";
import {Animation, Node, Root} from "@gltf-transform/core";
import {HashCreationBindGroupEntry, HashGenerator} from "../scene/GPURenderSystem/Hasher/HashGenerator.ts";
import {GPUCache} from "../scene/GPURenderSystem/GPUCache/GPUCache.ts";
import {BindGroupEntryCreationType} from "../scene/GPURenderSystem/GPUCache/GPUCacheTypes.ts";
import {SceneObject} from "../scene/sceneObject/sceneObject.ts";
import {createGPUBuffer, makePrimitiveKey, unpackPrimitiveKey} from "../helpers/global.helper.ts";
import {SmartRender} from "../scene/GPURenderSystem/SmartRender/SmartRender.ts";
import {ComputeManager} from "../scene/computation/computeManager.ts";
import {quat, vec3} from "gl-matrix";
import {ModelAnimator} from "../scene/modelAnimator/modelAnimator.ts";
import {Material} from "../scene/Material/Material.ts";
import {RenderFlag} from "../scene/GPURenderSystem/MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";
import {Primitive} from "../scene/primitive/Primitive.ts";


export type ShaderCodeEntry = { code: string, primitives: Primitive[] }
export type MaterialBindGroupEntry = {
    hashEntries: HashCreationBindGroupEntry,
    entries: BindGroupEntryCreationType[],
    layout: GPUBindGroupLayoutEntry[]
}

export type PipelineEntry = {
    primitive: Primitive,
    sceneObject: SceneObject,
}[]
export type GeometryBindGroupEntry = {
    entries: (GPUBindGroupEntry & { name?: "model" | "normal", })[],
    primitives: Primitive[],
}[]

export type SmartRenderInitEntryPassType = {
    pipelineDescriptors: PipelineEntry,
}

type initEntry = SmartRenderInitEntryPassType
type PipelineLayoutHashItem = {
    primitive: Primitive
    sceneObject: SceneObject
    hash: number
}
type modelRendererEntry = {
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    ctx: GPUCanvasContext,
    hasher: HashGenerator,
    gpuCache: GPUCache,
    smartRenderer: SmartRender
    computeManager: ComputeManager,
    modelAnimator: ModelAnimator
}


export class ModelRenderer extends BaseLayer {
    private root!: Root;
    private smartRenderer!: SmartRender;
    private hasher: HashGenerator;
    private computeManager!: ComputeManager;
    private gpuCache: GPUCache;
    private materials: Material[] = [];
    private initEntry!: initEntry;
    private sceneObjects: Set<SceneObject> = new Set();
    private modelAnimator: ModelAnimator;
    private nodeMap: Map<Node, SceneObject> = new Map();

    constructor({
                    device,
                    canvas,
                    ctx,
                    smartRenderer,
                    hasher,
                    gpuCache,
                    computeManager,
                    modelAnimator
                }: modelRendererEntry) {
        super(device, canvas, ctx);
        this.hasher = hasher;
        this.smartRenderer = smartRenderer;
        this.gpuCache = gpuCache;
        this.computeManager = computeManager;
        this.modelAnimator = modelAnimator
    }

    public fillInitEntry(T: initEntry | RenderFlag) {
        if (typeof T === "number") {
            if (!this.smartRenderer) throw new Error("SmartRenderer is not set");
            if (!this.sceneObjects) throw new Error("sceneObjects is not set");
            this.initEntry = this.smartRenderer.entryCreator(this.sceneObjects, T)
        } else {
            this.initEntry = T
        }
    }

    public setSceneObjects(sceneObjects: Set<SceneObject>) {
        this.sceneObjects = sceneObjects;
        this.sceneObjects.forEach(sceneObject => {
            sceneObject.primitives?.forEach(primitive => {
                this.materials.push(primitive.material)
            })
        })
    }

    public setRoot(root: Root) {
        this.root = root;
    }

    public setTranslation(t: vec3) {
        if (!this.sceneObjects) throw new Error("sceneObjects is not set");
        for (const sceneObject of this.sceneObjects) {
            if (!sceneObject.parent) {
                sceneObject.setTranslation(sceneObject.transformMatrix, t);
            }
        }
    }

    public setRotation(r: quat) {
        if (!this.sceneObjects) throw new Error("sceneObjects is not set");
        for (const sceneObject of this.sceneObjects) {
            if (!sceneObject.parent) {
                sceneObject.setRotation(sceneObject.transformMatrix, r);
            }
        }
    }

    public setScale(s: vec3) {
        if (!this.sceneObjects) throw new Error("sceneObjects is not set");
        for (const sceneObject of this.sceneObjects) {
            if (!sceneObject.parent) {
                sceneObject.setScale(sceneObject.transformMatrix, s);
            }
        }
    }

    public setLodThreshold(threshold: number) {
        if (!this.sceneObjects) throw new Error("sceneObjects is not set");
        this.sceneObjects.forEach(sceneObject => {
            if (sceneObject.mesh && sceneObject.primitives && sceneObject.primitives.size > 0) {
                sceneObject.setLodSelectionThreshold(threshold);
                this.computeManager.setLodSelection(sceneObject)
            }
        })
    }

    public enableFrustumCulling() {
        if (!this.sceneObjects) throw new Error("sceneObjects is not set");
        this.sceneObjects.forEach(sceneObject => {
            if (sceneObject.mesh && sceneObject.primitives && sceneObject.primitives.size > 0) {
                this.computeManager.setFrustumCulling(sceneObject)
            }
        })
    }

    public animate(animation: Animation, mode: "loop" | "backAndForth" | undefined = undefined) {
        if (!this.sceneObjects) throw new Error("sceneObjects is not set");
        ModelRenderer.renderLoopAnimations.push(() => {
            const time = performance.now() / 1000
            this.modelAnimator.update(animation, time, mode, this.nodeMap)
        })
    }


    private createGeometryLayoutHashes(primitives: Primitive[]) {
        const layoutHashes = new Map<number, number>();
        primitives.forEach((prim) => {
            const layoutEntries = prim.geometry.descriptors.layout!;
            const hash = this.hasher.hashBindGroupLayout(layoutEntries)
            this.gpuCache.appendBindGroupLayout(layoutEntries, hash, prim)
            layoutHashes.set(prim.id, hash)
            prim.geometry.setBindGroupLayoutHash(hash)

        })

        return layoutHashes
    }


    private async createMaterialHashes(materials: Material[]) {
        const materialHashes = new Map<number, {
            layout: number,
            bindGroup: number
        }>();
        for (let i = 0; i < materials.length; i++) {
            const materialItem = materials[i];
            const materialHash = await this.hasher.hashBindGroup(materialItem.descriptor.hashEntries);
            const materialLayoutHash = this.hasher.hashBindGroupLayout(materialItem.descriptor.layout)


            materialItem.setHashes("bindGroupLayout", materialLayoutHash)
            materialItem.setHashes("bindGroup", materialHash)
            if (!this.root) throw new Error("root is not set")
            const materialPrimitives: Primitive[] = [];

            materialItem.primitives.forEach((primitive) => {
                materialPrimitives.push(primitive)
                materialHashes.set(primitive.id, {
                    layout: materialLayoutHash,
                    bindGroup: materialHash
                })
                this.gpuCache.appendBindGroupLayout(
                    materialItem.descriptor.layout,
                    materialLayoutHash,
                    primitive
                );
            })
            if (materialItem.samplerInfo.descriptor) {
                const samplerHash = this.hasher.hashSampler(materialItem.samplerInfo.descriptor)
                materialItem.setHashes("sampler", samplerHash)
                this.gpuCache.appendSampler(materialItem.samplerInfo.descriptor, samplerHash, materialPrimitives)
            }


            await this.gpuCache.appendMaterialBindGroup(
                materialItem,
                materialHash,
                materialLayoutHash,
                materialPrimitives
            );
        }

        return materialHashes
    }

    private createShaderCodeHashes(primitives: Primitive[]) {
        const shaderCodesHashes = new Map<number, number>();
        for (let i = 0; i < primitives.length; i++) {
            const item = primitives[i];
            const hash = this.hasher.hashShaderModule(item.material.shaderCode)


            shaderCodesHashes.set(item.id, hash)
            item.material.setHashes("shader", hash)

            this.gpuCache.appendShaderModule(item.material.shaderCode, hash, item)
        }

        return shaderCodesHashes
    }

    private createPipelineLayoutHashes(pipelineDescriptors: PipelineEntry, materialLayoutHashes: Map<number, {
        layout: number,
        bindGroup: number
    }>, geometryLayoutHashes: Map<number, number>) {
        const pipelineLayoutsHashes = new Map<number, PipelineLayoutHashItem>();

        for (let i = 0; i < pipelineDescriptors.length; i++) {
            const item = pipelineDescriptors[i];

            let materialLayout = materialLayoutHashes.get(item.primitive.id)?.layout!
            let geometryLayout = geometryLayoutHashes.get(item.primitive.id)

            const hash = this.hasher.hashPipelineLayout(
                materialLayout!,
                geometryLayout!
            )
            this.gpuCache.appendPipelineLayout(
                hash,
                materialLayout!,
                geometryLayout!,
                item.primitive
            )
            pipelineLayoutsHashes.set(item.primitive.id, {
                ...item,
                hash
            });
        }

        return pipelineLayoutsHashes
    }

    private createPipelineHashes(shaderCodesHashes: Map<number, number>, pipelineLayoutsHashes: Map<number, PipelineLayoutHashItem>) {
        const pipelineHashes = new Map<string, number>();
        pipelineLayoutsHashes.forEach((item) => {
            const shaderCodeHash = shaderCodesHashes.get(item.primitive.id)!
            item.primitive.side.forEach((side) => {
                const pipelineDescriptor = item.primitive.pipelineDescriptors.get(side)!

                const hash = this.hasher.hashPipeline(pipelineDescriptor, item.hash, item.primitive.vertexBufferDescriptors)
                this.gpuCache.appendPipeline(pipelineDescriptor, hash, item.hash, shaderCodeHash!, item.primitive)

                pipelineHashes.set(makePrimitiveKey(item.primitive.id, side), hash)
            })
        })
        return pipelineHashes
    }

    private createGeometryBindGroupMaps(primitives: Primitive[]) {
        const geometryBindGroupMaps = new Map<number, (GPUBindGroupEntry & {
            name?: "model" | "normal"
        })[]>();
        primitives.forEach((item) => {

            geometryBindGroupMaps.set(item.id, item.geometry.descriptors.bindGroup!)

        })

        return geometryBindGroupMaps
    }

    public async init() {
        if (!this.initEntry) throw new Error("init entry is not filled")
        const {
            pipelineDescriptors,
        } = this.initEntry
        const primitives = pipelineDescriptors.map(entry => {
            return entry.primitive
        })
        const geometryLayoutHashes = this.createGeometryLayoutHashes(primitives)
        const materialHashes = await this.createMaterialHashes(this.materials)
        const shaderCodesHashes = this.createShaderCodeHashes(primitives)
        const pipelineLayoutsHashes = this.createPipelineLayoutHashes(pipelineDescriptors, materialHashes, geometryLayoutHashes)
        const pipelineHashes = this.createPipelineHashes(shaderCodesHashes, pipelineLayoutsHashes)
        const geometryBindGroupMaps = this.createGeometryBindGroupMaps(primitives)
        const sceneObjects: Map<number, SceneObject> = new Map();
        pipelineHashes.forEach((pipelineHash, key) => {
            const {side, id: primitiveId} = unpackPrimitiveKey(key)
            const geometryEntries = geometryBindGroupMaps.get(primitiveId)
            const geometryLayoutHash = geometryLayoutHashes.get(primitiveId)!
            const materialBindGroupHash = materialHashes.get(primitiveId)?.bindGroup!

            const shaderCodeHash = shaderCodesHashes.get(primitiveId)!

            const pipelineLayout = pipelineLayoutsHashes.get(primitiveId)
            const primitive = pipelineLayout?.primitive!
            const renderSetup = this.gpuCache.getRenderSetup(
                pipelineHash,
                pipelineLayout?.hash!,
                materialBindGroupHash,
                geometryLayoutHash,
                shaderCodeHash
            )
            const geometryBindGroup = BaseLayer.device.createBindGroup({
                entries: geometryEntries as any,
                label: `${pipelineLayout?.sceneObject.name ?? ""} geometry bindGroup`,
                layout: renderSetup.geometryBindGroupLayout
            })


            primitive.geometry.setBindGroup(geometryBindGroup)

            primitive.setPipeline(side!, renderSetup.pipeline)


            primitive.setBindGroup(`${materialBindGroupHash}`, {
                bindGroup: renderSetup.materialBindGroup,
                location: 1
            })
            primitive.setBindGroup(geometryBindGroup.label, {bindGroup: geometryBindGroup, location: 2})

            primitive.setLodRanges(primitive.geometry.lodRanges)
            primitive.setIndexData(primitive.geometry.indices)

            pipelineLayout?.primitive.vertexBufferDescriptors.forEach((item) => {
                primitive.setVertexBuffers(createGPUBuffer(BaseLayer.device, primitive.geometry.dataList.get(item.name)?.array!, GPUBufferUsage.VERTEX, `${pipelineLayout.sceneObject.name}  ${item.name}`))
            })

            sceneObjects.set((pipelineLayout as any).sceneObject.id, (pipelineLayout as any).sceneObject)
            primitive.modelMatrix = (pipelineLayout?.sceneObject!).worldMatrix;
            primitive.normalMatrix = (pipelineLayout?.sceneObject!).normalMatrix;

            ModelRenderer.appendDrawCall = primitive
            if (primitive.geometry.indices) {
                this.computeManager.setIndex(pipelineLayout?.sceneObject as SceneObject)
            }
            this.computeManager.setIndirect(pipelineLayout?.sceneObject as SceneObject)
        })

        const nodeMap = new Map<Node, SceneObject>()
        this.sceneObjects.forEach(sceneObject => nodeMap.set(sceneObject.nodeReference, sceneObject))
        this.nodeMap = nodeMap;
    }
}