import {Animation, Node} from "@gltf-transform/core";
import {GPUCache} from "../engine/GPURenderSystem/GPUCache/GPUCache.ts";
import {SceneObject} from "../engine/sceneObject/sceneObject.ts";
import {hashAndCreateRenderSetup} from "../helpers/global.helper.ts";
import {quat, vec3} from "gl-matrix";
import {ModelAnimator} from "../engine/modelAnimator/modelAnimator.ts";
import {MaterialInstance} from "../engine/Material/Material.ts";
import {Primitive} from "../engine/primitive/Primitive.ts";
import {Scene} from "../engine/scene/Scene.ts";
import {BaseLayer} from "../layers/baseLayer.ts";

export type PipelineLayoutHashItem = {
    primitive: Primitive
    hash: number
}



export class ModelRenderer {
    materials = new Set<MaterialInstance>();
    private sceneObjects: Set<SceneObject> = new Set();
    private modelAnimator: ModelAnimator;
    private nodeMap: Map<Node, SceneObject> = new Map();
    private scene: Scene | null = null;

    constructor() {
        this.modelAnimator = new ModelAnimator()
    }

    public fillInitEntry() {
        if (this.sceneObjects.size === 0) throw new Error("sceneObjects is not set");
        if (!this.scene) throw new Error("scene is not set");

        GPUCache.smartRenderer.entryCreator(this.sceneObjects, this.nodeMap, Array.from(this.materials), this.scene)
    }

    reset() {
        this.materials.clear();
        this.sceneObjects.clear();
        this.nodeMap.clear();
        this.scene = null;
    }

    setScene(scene: Scene) {
        this.scene = scene;
    }

    public setNodeMap(map: Map<Node, SceneObject>) {
        this.nodeMap = map;
    }

    public setSceneObjects(sceneObjects: Set<SceneObject>) {
        this.sceneObjects = sceneObjects;
        if (!this.scene) throw new Error("scene is not set");

        this.sceneObjects.forEach(sceneObject => {
            sceneObject.scene = this.scene as Scene
            sceneObject.primitives?.forEach(primitive => {
                this.materials.add(primitive.material)
            })
        })
    }

    public setTranslation(x: number, y: number, z: number) {
        if (this.sceneObjects.size === 0) throw new Error("sceneObjects is not set");
        for (const sceneObject of this.sceneObjects) {
            if (!sceneObject.parent) {
                sceneObject.setTranslation(sceneObject.transformMatrix, vec3.fromValues(x, y, z));
            }
        }
    }

    public setRotation(x: number, y: number, z: number, w: number) {
        if (this.sceneObjects.size === 0) throw new Error("sceneObjects is not set");
        for (const sceneObject of this.sceneObjects) {
            if (!sceneObject.parent) {
                sceneObject.setRotation(sceneObject.transformMatrix, quat.fromValues(x, y, z, w));
            }
        }
    }

    public setScale(x: number, y: number, z: number) {
        if (this.sceneObjects.size === 0) throw new Error("sceneObjects is not set");
        for (const sceneObject of this.sceneObjects) {
            if (!sceneObject.parent) {
                sceneObject.setScale(sceneObject.transformMatrix, vec3.fromValues(x, y, z));
            }
        }
    }

    public setLodThreshold(threshold: number) {
        if (this.sceneObjects.size === 0) throw new Error("sceneObjects is not set");
        if (!this.scene) throw new Error("scene is not set");
        this.sceneObjects.forEach(sceneObject => {
            if (sceneObject.primitives && sceneObject.primitives.size > 0) {
                sceneObject.setLodSelectionThreshold(threshold);
                this.scene!.computeManager.setLodSelection(sceneObject)
            }
        })
    }

    public enableFrustumCulling() {
        if (this.sceneObjects.size === 0) throw new Error("sceneObjects is not set");
        if (!this.scene) throw new Error("scene is not set");
        this.sceneObjects.forEach(sceneObject => {
            if (sceneObject.primitives && sceneObject.primitives.size > 0) {
                this.scene!.computeManager.setFrustumCulling(sceneObject)
            }
        })
    }

    public animate(animation: Animation, mode: "loop" | "backAndForth" | undefined = undefined) {
        if (this.sceneObjects.size === 0) throw new Error("sceneObjects is not set");
        if (!this.scene) throw new Error("scene is not set");
        this.scene.renderLoopAnimations.push(() => {
            const time = performance.now() / 1000
            this.modelAnimator.update(animation, time, mode, this.nodeMap)
        })
    }


    public async init() {

        const primitives: Primitive[] = []

        this.fillInitEntry()
        if (!this.scene) throw new Error("scene is not set");

        if (this.scene.transmissionPrimitives.size > 0 && !BaseLayer.sceneOpaqueTexture) {
            BaseLayer.setSceneOpaqueOnlyTexture()
        }
        this.sceneObjects.forEach(sceneObject => {
            sceneObject.primitives?.forEach(p => primitives.push(p))
        })
        await hashAndCreateRenderSetup(this.scene.computeManager, Array.from(this.materials), primitives)
        primitives.forEach(primitive => this.scene!.appendDrawCall = primitive)
        primitives.forEach(primitive => {
            const material = primitive.material;
            const geo = primitive.geometry;
            material.initialized = true
            material.bindingCounter = 0;
            material.shaderCode = null;
            material.shaderDescriptor = {
                ...material.shaderDescriptor,
                compileHints: [],
                bindings: []
            }
            material.descriptor.bindGroupEntries = []
            material.descriptor.layoutEntries = []

            geo.descriptors.layout = []
            geo.descriptors.bindGroup = []
            geo.shaderCode = null
            geo.shaderDescriptor = {
                ...geo.shaderDescriptor,
                compileHints: [],
                bindings: []
            }
        })
    }
}