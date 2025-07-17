import {Animation, Node} from "@gltf-transform/core";
import {HashCreationBindGroupEntry} from "../engine/GPURenderSystem/Hasher/HashGenerator.ts";
import {GPUCache} from "../engine/GPURenderSystem/GPUCache/GPUCache.ts";
import {BindGroupEntryCreationType} from "../engine/GPURenderSystem/GPUCache/GPUCacheTypes.ts";
import {SceneObject} from "../engine/sceneObject/sceneObject.ts";
import {hashAndCreateRenderSetup} from "../helpers/global.helper.ts";
import {SmartRender} from "../engine/GPURenderSystem/SmartRender/SmartRender.ts";
import {quat, vec3} from "gl-matrix";
import {ModelAnimator} from "../engine/modelAnimator/modelAnimator.ts";
import {Material} from "../engine/Material/Material.ts";
import {RenderFlag} from "../engine/GPURenderSystem/MaterialDescriptorGenerator/MaterialDescriptorGeneratorTypes.ts";
import {Primitive} from "../engine/primitive/Primitive.ts";
import {Scene} from "../engine/scene/Scene.ts";


export type MaterialBindGroupEntry = {
    hashEntries: HashCreationBindGroupEntry,
    entries: BindGroupEntryCreationType[],
    layout: GPUBindGroupLayoutEntry[]
}

export type PipelineEntry = {
    primitive: Primitive,
    sceneObject: SceneObject,
}[]

export type SmartRenderInitEntryPassType = {
    pipelineDescriptors: PipelineEntry,
}

type initEntry = SmartRenderInitEntryPassType
export type PipelineLayoutHashItem = {
    primitive: Primitive
    sceneObject: SceneObject
    hash: number
}
type modelRendererEntry = {
    gpuCache: GPUCache,
    scene: Scene,
    device: GPUDevice
    format: GPUTextureFormat
}


export class ModelRenderer {
    private smartRenderer!: SmartRender;
    private gpuCache: GPUCache;
    private materials: Material[] = [];
    private initEntry!: initEntry;
    private sceneObjects: Set<SceneObject> = new Set();
    private modelAnimator: ModelAnimator;
    private nodeMap: Map<Node, SceneObject> = new Map();
    private scene: Scene;

    constructor({
                    gpuCache,
                    scene,
                    format,
                    device
                }: modelRendererEntry) {
        this.smartRenderer = new SmartRender(device, format);
        this.gpuCache = gpuCache;
        this.modelAnimator = new ModelAnimator()
        this.scene = scene;
    }

    public fillInitEntry(T: initEntry | RenderFlag) {
        if (typeof T === "number") {
            if (!this.smartRenderer) throw new Error("SmartRenderer is not set");
            if (this.sceneObjects.size === 0) throw new Error("sceneObjects is not set");
            this.initEntry = this.smartRenderer.entryCreator(this.sceneObjects, T, this.nodeMap)
        } else {
            this.initEntry = T
        }
    }

    public setNodeMap(map: Map<Node, SceneObject>) {
        this.nodeMap = map;
    }

    public setSceneObjects(sceneObjects: Set<SceneObject>) {
        this.sceneObjects = sceneObjects;
        this.sceneObjects.forEach(sceneObject => {
            sceneObject.scene = this.scene
            sceneObject.primitives?.forEach(primitive => {
                this.materials.push(primitive.material)
            })
        })
    }

    public setTranslation(t: vec3) {
        if (this.sceneObjects.size === 0) throw new Error("sceneObjects is not set");
        for (const sceneObject of this.sceneObjects) {
            if (!sceneObject.parent) {
                sceneObject.setTranslation(sceneObject.transformMatrix, t);
            }
        }
    }

    public setRotation(r: quat) {
        if (this.sceneObjects.size === 0) throw new Error("sceneObjects is not set");
        for (const sceneObject of this.sceneObjects) {
            if (!sceneObject.parent) {
                sceneObject.setRotation(sceneObject.transformMatrix, r);
            }
        }
    }

    public setScale(s: vec3) {
        if (this.sceneObjects.size === 0) throw new Error("sceneObjects is not set");
        for (const sceneObject of this.sceneObjects) {
            if (!sceneObject.parent) {
                sceneObject.setScale(sceneObject.transformMatrix, s);
            }
        }
    }

    public setLodThreshold(threshold: number) {
        if (this.sceneObjects.size === 0) throw new Error("sceneObjects is not set");
        this.sceneObjects.forEach(sceneObject => {
            if (sceneObject.primitives && sceneObject.primitives.size > 0) {
                sceneObject.setLodSelectionThreshold(threshold);
                this.scene.computeManager.setLodSelection(sceneObject)
            }
        })
    }

    public enableFrustumCulling() {
        if (this.sceneObjects.size === 0) throw new Error("sceneObjects is not set");
        this.sceneObjects.forEach(sceneObject => {
            if (sceneObject.primitives && sceneObject.primitives.size > 0) {
                this.scene.computeManager.setFrustumCulling(sceneObject)
            }
        })
    }

    public animate(animation: Animation, mode: "loop" | "backAndForth" | undefined = undefined) {
        if (this.sceneObjects.size === 0) throw new Error("sceneObjects is not set");
        this.scene.renderLoopAnimations.push(() => {
            const time = performance.now() / 1000
            this.modelAnimator.update(animation, time, mode, this.nodeMap)
        })
    }

    public async init() {
        if (!this.initEntry) throw new Error("init entry is not filled")

        const {
            pipelineDescriptors,
        } = this.initEntry
        const primitives = pipelineDescriptors.map(entry => {
            return entry.primitive
        })
        await hashAndCreateRenderSetup(this.scene.computeManager, this.gpuCache, this.materials, primitives, pipelineDescriptors)
        primitives.forEach(primitive => this.scene.appendDrawCall = primitive)
    }
}