import {LODRange} from "../loader/loaderTypes.ts";
import {TypedArray} from "@gltf-transform/core";
import {RenderState} from "../GPURenderSystem/GPUCache/GPUCacheTypes.ts";
import {mat3, mat4} from "gl-matrix";
import {Geometry} from "../geometry/Geometry.ts";
import {generateID} from "../../helpers/global.helper.ts";
import {SceneObject} from "../sceneObject/sceneObject.ts";
import {ToneMapping} from "../../helpers/postProcessUtils/postProcessUtilsTypes.ts";
import {MaterialInstance} from "../Material/Material.ts";
import {BaseLayer} from "../../layers/baseLayer.ts";

export type Side = "front" | "back" | "none"

export type PrimitiveHashes = {
    shader: {
        vertex: number,
        fragment: number,
    },
    pipeline: number,
    pipelineLayout: number,
}


export class Primitive {
    id!: number;
    pipelines = new Map<Side, GPURenderPipeline>();
    vertexBuffers: GPUBuffer[] = [];
    lodRanges: LODRange[] | undefined = undefined;
    indexData: TypedArray | undefined = undefined;
    sides: (Side)[] = [];
    vertexBufferDescriptors: (GPUVertexBufferLayout & { name: string; })[] = []
    pipelineDescriptors = new Map<Side, RenderState>();
    modelMatrix!: mat4;
    normalMatrix!: mat3;
    indexBufferStartIndex!: number;
    indirectBufferStartIndex!: number;
    geometry!: Geometry
    material!: MaterialInstance
    sceneObject!: SceneObject
    primitiveHashes = new Map<Side, PrimitiveHashes>();


    constructor() {
        this.id = generateID();
    }


    setPrimitiveHashes(hashes: PrimitiveHashes, side: Side) {
        this.primitiveHashes.set(side, hashes);
    }

    setMaterial(material: MaterialInstance) {
        this.material = material
    }

    setGeometry(geometry: Geometry) {
        this.geometry = geometry;
    }

    updateExposure(exposure: number) {
        this.pipelineDescriptors.forEach(descriptor => {
            descriptor.fragmentConstants ? descriptor.fragmentConstants.EXPOSURE = exposure : null
        })
        BaseLayer.pipelineUpdateQueue.add(this)
    }

    updateToneMapping(toneMapping: ToneMapping) {
        this.pipelineDescriptors.forEach(descriptor => {
            descriptor.fragmentConstants ? descriptor.fragmentConstants.TONE_MAPPING_NUMBER = toneMapping : null
        })
        BaseLayer.pipelineUpdateQueue.add(this)
    }

    setVertexBufferDescriptors(descriptors: (GPUVertexBufferLayout & { name: string; })[]) {
        this.vertexBufferDescriptors = descriptors;
    }

    setLodRanges(lodRanges: LODRange[] | undefined) {
        this.lodRanges = lodRanges;
    }

    setPipelineDescriptor(side: Side, pipelineDescriptor: RenderState) {
        this.pipelineDescriptors.set(side, pipelineDescriptor);
    }

    setPipeline(side: Side) {
        const hashes=this.primitiveHashes.get(side)!
        const pipeline = (BaseLayer.gpuCache.getResource(`${hashes.pipelineLayout}${hashes.shader.fragment}${hashes.shader.vertex}${hashes.pipeline}`, "pipelineMap") as any).pipeline as GPURenderPipeline
        this.pipelines.set(side, pipeline);
    }

    setVertexBuffers(vertexBuffers: GPUBuffer) {
        this.vertexBuffers.push(vertexBuffers);
    }

    setIndexData(data: TypedArray | undefined) {
        this.indexData = data;
    }

    setSide(side: Side) {
        this.sides.push(side)
    }

    setSceneObject(sceneObject: SceneObject) {
        this.sceneObject = sceneObject;
    }

}