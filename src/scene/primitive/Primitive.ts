import {LODRange} from "../loader/loaderTypes.ts";
import {TypedArray} from "@gltf-transform/core";
import {RenderState} from "../GPURenderSystem/GPUCache/GPUCacheTypes.ts";
import {mat3, mat4} from "gl-matrix";
import {Geometry} from "../geometry/Geometry.ts";
import {Material} from "../Material/Material.ts";

type side = "front" | "back" | "none"

export class Primitive {
    id!: number;
    pipelines = new Map<side, GPURenderPipeline>();
    bindGroups = new Map<string, { bindGroup: GPUBindGroup, location: number }>();
    vertexBuffers: GPUBuffer[] = [];
    lodRanges: LODRange[] | undefined = undefined;
    indexData: TypedArray | undefined = undefined;
    side: (side)[] = [];
    isTransparent: boolean = false;
    vertexBufferDescriptors: (GPUVertexBufferLayout & { name: string; })[] = []
    pipelineDescriptors = new Map<side, RenderState>();
    modelMatrix!: mat4;
    normalMatrix!: mat3;
    indexBufferStartIndex!: number;
    indirectBufferStartIndex!: number;
    geometry!: Geometry
    material!: Material

    constructor({id}: { id: number }) {
        this.id = id;
    }

    setMaterial(material:Material) {
        this.material = material
    }
    setGeometry(geometry: Geometry) {
        this.geometry = geometry;
    }

    setVertexBufferDescriptors(descriptors: (GPUVertexBufferLayout & { name: string; })[]) {
        this.vertexBufferDescriptors = descriptors;
    }

    setIsTransparent(transparent: boolean) {
        this.isTransparent = transparent;
    }

    setLodRanges(lodRanges: LODRange[] | undefined) {
        this.lodRanges = lodRanges;
    }

    setPipelineDescriptor(side: side, pipelineDescriptor: RenderState) {
        this.pipelineDescriptors.set(side, pipelineDescriptor);
    }

    setPipeline(side: side, pipeline: GPURenderPipeline) {
        this.pipelines.set(side, pipeline);
    }

    setBindGroup(label: string, value: { bindGroup: GPUBindGroup, location: number }) {
        this.bindGroups.set(label, value);
    }

    setVertexBuffers(vertexBuffers: GPUBuffer) {
        this.vertexBuffers.push(vertexBuffers);
    }

    setIndexData(data: TypedArray | undefined) {
        this.indexData = data;
    }

    setSide(side: side) {
        this.side.push(side)
    }

    setModelMatrix(modelMatrix: mat4) {
        this.modelMatrix = modelMatrix
    }

    setNormal(normalMatrix: mat3) {
        this.normalMatrix = normalMatrix
    }
}