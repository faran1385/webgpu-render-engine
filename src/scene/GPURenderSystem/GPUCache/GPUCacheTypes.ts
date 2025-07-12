import {TypedArray, vec2} from "@gltf-transform/core";
import {vec3} from "gl-matrix";
import {Material} from "../../Material/Material.ts"
import {Primitive} from "../../primitive/Primitive.ts";

export type bufferConvertFunc = (device: GPUDevice, data: TypedArray, usage: GPUBufferUsageFlags, label: string) => GPUBuffer
export type textureConvertFunc = (device: GPUDevice, size: vec2 | vec3, data: TypedArray) => Promise<GPUTexture>
export type BindGroupEntryCreationType = {
    texture?: GPUTexture,
    typedArray?: {
        conversion: bufferConvertFunc | textureConvertFunc,
        data: TypedArray,
    } & ({
        conversionType: "texture",
        size: vec2 | vec3
    } | {
        conversionType: "buffer",
        label: string,
        usage: GPUBufferUsageFlags,
    }),
    buffer?: GPUBuffer,
    sampler?: number,
    bindingPoint: number,
    materialKey: string
}

export type CreateBindGroupEntry = {
    layoutList: Map<number, {
        layout: GPUBindGroupLayout,
        primitives: Set<Primitive>
    }>,
    layoutHash: number,
    bindGroupHash: number
    material: Material,
}
export type RenderState = {
    primitive: GPUPrimitiveState,
    targets: GPUColorTargetState[]
    depthStencil: GPUDepthStencilState
}