import {Animation, Node} from "@gltf-transform/core";
import {HashCreationBindGroupEntry} from "../engine/GPURenderSystem/Hasher/HashGenerator.ts";
import {GPUCache} from "../engine/GPURenderSystem/GPUCache/GPUCache.ts";
import {BindGroupEntryCreationType} from "../engine/GPURenderSystem/GPUCache/GPUCacheTypes.ts";
import {SceneObject} from "../engine/sceneObject/sceneObject.ts";
import {hashAndCreateRenderSetup} from "../helpers/global.helper.ts";
import {quat, vec3} from "gl-matrix";
import {ModelAnimator} from "../engine/modelAnimator/modelAnimator.ts";
import {MaterialInstance} from "../engine/Material/Material.ts";
import {Primitive} from "../engine/primitive/Primitive.ts";
import {Scene} from "../engine/scene/Scene.ts";


export type MaterialBindGroupEntry = {
    hashEntries: HashCreationBindGroupEntry,
    entries: BindGroupEntryCreationType[],
    layout: GPUBindGroupLayoutEntry[]
    sampler: GPUSamplerDescriptor | null
}

export type PipelineLayoutHashItem = {
    primitive: Primitive
    hash: number
}
type modelRendererEntry = {
    gpuCache: GPUCache,
    scene: Scene,
}


export class ModelRenderer {
    private gpuCache: GPUCache;
    materials = new Set<MaterialInstance>();
    private sceneObjects: Set<SceneObject> = new Set();
    private modelAnimator: ModelAnimator;
    private nodeMap: Map<Node, SceneObject> = new Map();
    private scene: Scene;

    constructor({
                    gpuCache,
                    scene,
                }: modelRendererEntry) {
        this.gpuCache = gpuCache;
        this.modelAnimator = new ModelAnimator()
        this.scene = scene;
    }

    public fillInitEntry() {
        if (this.sceneObjects.size === 0) throw new Error("sceneObjects is not set");
        GPUCache.smartRenderer.entryCreator(this.sceneObjects, this.nodeMap)
    }

    public setNodeMap(map: Map<Node, SceneObject>) {
        this.nodeMap = map;
    }

    public setSceneObjects(sceneObjects: Set<SceneObject>) {
        this.sceneObjects = sceneObjects;
        this.sceneObjects.forEach(sceneObject => {
            sceneObject.scene = this.scene
            sceneObject.primitives?.forEach(primitive => {
                this.materials.add(primitive.material)
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

        const primitives: Primitive[] = []
        this.sceneObjects.forEach(sceneObject => {
            sceneObject.primitives?.forEach(p => primitives.push(p))
        })
        await hashAndCreateRenderSetup(this.scene.computeManager, this.gpuCache, Array.from(this.materials), primitives)
        primitives.forEach(primitive => this.scene.appendDrawCall = primitive)
        this.materials.forEach(material => {
            material.textureDataMap.clear()
            material.descriptor = {
                entries: null,
                hashEntries: null,
                layout: null,
                sampler: null
            }
            material.initialized = true
        })
    }
}