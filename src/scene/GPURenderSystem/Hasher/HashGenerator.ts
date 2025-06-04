import xxhash, {XXHashAPI} from 'xxhash-wasm';
import {
    RenderState,
} from "../GPUCache/GPUCacheTypes.ts";
import {TypedArray} from "@gltf-transform/core";

export type hashCreationBindGroupEntry = (TypedArray | GPUSamplerDescriptor)[]

export class HashGenerator {
    private static hasher: XXHashAPI;
    private static textEncoder: TextEncoder;


    public async init() {
        HashGenerator.hasher = await xxhash();
        HashGenerator.textEncoder = new TextEncoder();
    }

    public async hashBindGroup(entries: hashCreationBindGroupEntry) {

        const stringParts = await Promise.all(entries.map(async (entry) => {
            if ("BYTES_PER_ELEMENT" in entry) {

                const buffer = entry.buffer.slice(
                    entry.byteOffset,
                    entry.byteOffset + entry.byteLength
                );
                const digest = await crypto.subtle.digest("SHA-1", buffer)

                return Array.from(new Uint8Array(digest))
                    .map(b => b.toString(16).padStart(2, "0"))
                    .join("");
            }
            let string = ''
            string += entry.magFilter === "linear" ? 0 : entry.magFilter === "nearest" ? 1 : 2;
            string += entry.minFilter === "linear" ? 0 : entry.minFilter === "nearest" ? 1 : 2;
            string += entry.addressModeU === "repeat" ? 0 : entry.addressModeU === "mirror-repeat" ? 1 : entry.addressModeU === "clamp-to-edge" ? 2 : 3;
            string += entry.addressModeV === "repeat" ? 0 : entry.addressModeV === "mirror-repeat" ? 1 : entry.addressModeV === "clamp-to-edge" ? 2 : 3;
            string += entry.addressModeW === "repeat" ? 0 : entry.addressModeW === "mirror-repeat" ? 1 : entry.addressModeW === "clamp-to-edge" ? 2 : 3;
            string += entry.compare === "less" ? 0 :
                entry.compare === "greater" ? 1 :
                    entry.compare === "always" ? 2 :
                        entry.compare === "equal" ? 3 :
                            entry.compare === "never" ? 4 :
                                entry.compare === "greater-equal" ? 5 :
                                    entry.compare === "less-equal" ? 6 :
                                        entry.compare === "not-equal" ? 7 : 8
            string += entry.mipmapFilter === "linear" ? 0 : entry.mipmapFilter === "nearest" ? 1 : 2;

            return string
        }))

        return HashGenerator.hasher.h32(stringParts.join());
    }

    public hashBindGroupLayout(entries: GPUBindGroupLayoutEntry[]) {
        let string = ''
        entries.forEach(entry => {
            string += entry.binding
            string += entry.visibility
            if (entry.buffer) {
                string += entry.buffer.type === "uniform" ? 0 : entry.buffer.type === "storage" ? 1 : 2
            } else if (entry.texture) {
                string += entry.texture.sampleType === "float" ? 0 :
                    entry.texture.sampleType === "sint" ? 1 :
                        entry.texture.sampleType === "uint" ? 2 :
                            entry.texture.sampleType === "depth" ? 3 : 4
            } else if (entry.sampler) {
                string += entry.sampler.type === "filtering" ? 0 :
                    entry.sampler.type === "comparison" ? 1 : 4
            }
        })
        return HashGenerator.hasher.h32(string);
    }

    public async hashShaderModule(shaderCode: string) {
        const data = HashGenerator.textEncoder.encode(shaderCode);

        const digest = await crypto.subtle.digest('SHA-1', data);

        return HashGenerator.hasher.h32(Array.from(new Uint8Array(digest))
            .map(b => b.toString(16).padStart(2, '0'))
            .join(''));
    }

    public hashPipelineLayout(materialLayoutHash: number, geometryLayoutHash: number) {

        return HashGenerator.hasher.h32(`${materialLayoutHash} ${geometryLayoutHash}`);
    }

    private hashRenderState(state: RenderState): string {
        let str = "";

        // --- Primitive ---
        const primitive = state.primitive ?? {} as GPUPrimitiveState;
        const topoMap: Record<GPUPrimitiveTopology, number> = {
            "point-list": 0,
            "line-list": 1,
            "line-strip": 2,
            "triangle-list": 3,
            "triangle-strip": 4
        };
        const frontFaceMap: Record<GPUFrontFace, number> = {"ccw": 0, "cw": 1};
        const cullModeMap: Record<GPUCullMode, number> = {"none": 0, "front": 1, "back": 2};

        str += topoMap[primitive.topology ?? "triangle-list"] ?? -1;
        str += primitive.stripIndexFormat ? 1 : 0;
        str += frontFaceMap[primitive.frontFace ?? "ccw"] ?? -1;
        str += primitive.cullMode ? (cullModeMap[primitive.cullMode] ?? -1) : -1;

        // --- Buffers ---
        for (const buffer of state.buffers ?? []) {
            str += buffer.stepMode === "instance" ? 1 : 0;
            str += buffer.arrayStride;
            for (const attr of buffer.attributes ?? []) {
                str += attr.shaderLocation;
                str += attr.offset;
                str += attr.format?.length ?? -1; // crude encoding
            }
        }

        // --- Targets ---
        for (const target of state.targets ?? []) {
            str += target.format?.length ?? -1;

            if (target.blend) {
                const color = target.blend.color;
                const alpha = target.blend.alpha;

                str += this.blendFactor(color?.srcFactor);
                str += this.blendFactor(color?.dstFactor);
                str += this.blendOp(color?.operation);

                str += this.blendFactor(alpha?.srcFactor);
                str += this.blendFactor(alpha?.dstFactor);
                str += this.blendOp(alpha?.operation);
            } else {
                str += "-1".repeat(6); // 6 digits for blend values
            }

            str += target.writeMask ?? 0xF;
        }

        // --- Depth-Stencil ---
        const ds = state.depthStencil ?? {} as GPUDepthStencilState;

        str += ds.depthWriteEnabled ? 1 : 0;
        str += this.compareFunc(ds.depthCompare ?? "always");

        const sf = ds.stencilFront;
        str += sf ? (
            this.compareFunc(sf.compare) +
            this.stencilOp(sf.failOp) +
            this.stencilOp(sf.depthFailOp) +
            this.stencilOp(sf.passOp)
        ) : "-1".repeat(4);

        const sb = ds.stencilBack;
        str += sb ? (
            this.compareFunc(sb.compare) +
            this.stencilOp(sb.failOp) +
            this.stencilOp(sb.depthFailOp) +
            this.stencilOp(sb.passOp)
        ) : "-1".repeat(4);

        str += ds.stencilReadMask ?? 0xffffffff;
        str += ds.stencilWriteMask ?? 0xffffffff;
        str += ds.format?.length ?? -1;

        return str;
    }

// --- Helpers ---

    private compareFunc(func: GPUCompareFunction | undefined): number {
        return [
            "never", "less", "equal", "less-equal",
            "greater", "not-equal", "greater-equal", "always"
        ].indexOf(func ?? "always");
    }

    private stencilOp(op: GPUStencilOperation | undefined): number {
        return [
            "keep", "zero", "replace",
            "invert", "increment-clamp",
            "decrement-clamp", "increment-wrap", "decrement-wrap"
        ].indexOf(op ?? "keep");
    }

    private blendFactor(f: GPUBlendFactor | undefined): number {
        return [
            "zero", "one", "src", "one-minus-src",
            "src-alpha", "one-minus-src-alpha", "dst",
            "one-minus-dst", "dst-alpha", "one-minus-dst-alpha",
            "src-alpha-saturated", "constant", "one-minus-constant"
        ].indexOf(f ?? "zero");
    }

    private blendOp(op: GPUBlendOperation | undefined): number {
        return ["add", "subtract", "reverse-subtract", "min", "max"].indexOf(op ?? "add");
    }


    public hashPipeline(state: RenderState, pipelineLayoutHash: number) {
        return HashGenerator.hasher.h32(this.hashRenderState(state) + pipelineLayoutHash);
    }

}