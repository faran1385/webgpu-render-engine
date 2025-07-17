import {LODRange} from "../loader/loaderTypes.ts";
import {TypedArray} from "@gltf-transform/core";
import {RenderState} from "../GPURenderSystem/GPUCache/GPUCacheTypes.ts";
import {mat3, mat4} from "gl-matrix";
import {Geometry} from "../geometry/Geometry.ts";
import {Material} from "../Material/Material.ts";
import {generateID} from "../../helpers/global.helper.ts";

export type Side = "front" | "back" | "none"

export type PrimitiveHashes = {
    shader: number,
    materialBindGroup: number,
    materialBindGroupLayout: number,
    pipeline: number,
    pipelineLayout: number,
    samplerHash: number | null
}

export class Primitive {
    id!: number;
    pipelines = new Map<Side, GPURenderPipeline>();
    bindGroups = new Map<string, { bindGroup: GPUBindGroup, location: number }>();
    vertexBuffers: GPUBuffer[] = [];
    lodRanges: LODRange[] | undefined = undefined;
    indexData: TypedArray | undefined = undefined;
    side: (Side)[] = [];
    isTransparent: boolean = false;
    vertexBufferDescriptors: (GPUVertexBufferLayout & { name: string; })[] = []
    pipelineDescriptors = new Map<Side, RenderState>();
    modelMatrix!: mat4;
    normalMatrix!: mat3;
    indexBufferStartIndex!: number;
    indirectBufferStartIndex!: number;
    geometry!: Geometry
    material!: Material
    primitiveHashes = new Map<Side, PrimitiveHashes>();


    constructor() {
        this.id = generateID();
    }


    setPrimitiveHashes(hashes: PrimitiveHashes, side: Side) {
        this.primitiveHashes.set(side, hashes);
    }

    setMaterial(material: Material) {
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

    setPipelineDescriptor(side: Side, pipelineDescriptor: RenderState) {
        this.pipelineDescriptors.set(side, pipelineDescriptor);
    }

    setPipeline(side: Side, pipeline: GPURenderPipeline) {
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

    setSide(side: Side) {
        this.side.push(side)
    }

    setModelMatrix(modelMatrix: mat4) {
        this.modelMatrix = modelMatrix
    }

    setNormal(normalMatrix: mat3) {
        this.normalMatrix = normalMatrix
    }
}