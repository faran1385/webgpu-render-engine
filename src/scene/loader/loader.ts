import {Document, WebIO, Root} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {mat3} from 'gl-matrix';
import {
    AttributeData,
    GeometryData,
    LoaderOptions,
    LODRange,
    MeshData,
} from "./loaderTypes.ts";

const io = new WebIO().registerExtensions(ALL_EXTENSIONS);

/** A GLTF/GLB loader class with optional caching and progress reporting. */
export class GLTFLoader {
    /**
     * Loads a model from URL and returns document, meshes, buffers, and animations.
     */
    public async load(url: string,): Promise<{
        document: Document;
        meshes: MeshData[];
        buffers: any[];
        animations: any[];
        root: Root
    }> {
        if (this.options.useCache && this.cache.has(url)) {
            return this.cache.get(url);
        }
        this.options.onProgress?.(0, 1);
        let document = await io.read(url);


        const root = document.getRoot();
        const buffers = root.listBuffers();
        const animations = this.extractAnimations();
        const meshes = await this.extractMeshes(root);
        const result = {
            document,
            meshes,
            buffers,
            animations,
            root
        };
        if (this.options.useCache) this.cache.set(url, result);
        this.options.onProgress?.(1, 1);

        return result;
    }

    private cache = new Map<string, any>();

    constructor(private options: LoaderOptions = {}) {
    }

    private extractAnimations(): any[] {
        return [];
    }

    private async extractMeshes(root: any): Promise<MeshData[]> {
        const nodes = root.listNodes();
        const total = nodes.length;
        const meshes: MeshData[] = [];
        let count = 0;
        for (const node of nodes) {
            const mesh = node.getMesh();
            if (mesh) {
                const localMat = new Float32Array(node.getWorldMatrix());
                // Compute normal matrix (inverse-transpose of upper-left 3x3)
                const normalMat = new Float32Array(9);
                mat3.fromMat4(normalMat as any, localMat as any);
                mat3.invert(normalMat as any, normalMat as any);
                mat3.transpose(normalMat as any, normalMat as any);
                const normalMatData = new Float32Array([
                    normalMat[0], normalMat[1], normalMat[2], 0,
                    normalMat[3], normalMat[4], normalMat[5], 0,
                    normalMat[6], normalMat[7], normalMat[8], 0,
                ])

                const geometry = await this.extractGeometry(mesh);
                meshes.push({
                    nodeName: node.getName() || 'unnamed',
                    localMatrix: localMat,
                    normalMatrix: normalMatData,
                    geometry,
                });
            }
            count++;
            this.options.onProgress?.(count, total);
        }
        return meshes;
    }

    /** Extracts and separates vertex attributes, uniforms, and pipeline layouts. */
    private async extractGeometry(mesh: any): Promise<GeometryData[]> {

        const primitives = mesh.listPrimitives();

        const geometryData: GeometryData[] = [];
        for (const prim of primitives) {
            console.log(prim.getMode())
            let lodRanges: LODRange[] | undefined = undefined;
            if (prim.getExtras().lodRanges) {
                lodRanges = prim.getExtras().lodRanges;
            }
            const uniforms: Record<string, AttributeData> = {};
            const vertex: Partial<Record<'position' | 'normal' | 'uv', AttributeData>> = {};
            const semantics = prim.listSemantics();

            prim.listAttributes().forEach((accessor: any, i: number) => {
                const array = accessor.getArray() as Float32Array;
                const type = accessor.getType() as string;
                const itemSize =
                    type === 'SCALAR' ? 1 :
                        type === 'VEC2' ? 2 :
                            type === 'VEC3' ? 3 :
                                type === 'VEC4' ? 4 : array.length;
                const name = semantics[i];
                const data: AttributeData = {array, itemSize};
                if (name === 'POSITION' || name === 'NORMAL' || name === 'TEXCOORD_0' || name === "TANGENT") {
                    const key = name === 'TEXCOORD_0' ? 'uv' : name.toLowerCase() as 'position' | 'normal' | "tangent";
                    (vertex as any)[key] = data;
                } else {
                    uniforms[name] = data;
                }
            });

            // Warn if missing essential vertex attributes
            ['position', 'normal', 'uv'].forEach((attr) => {
                if (!vertex[attr as keyof typeof vertex]) {
                    console.warn(`Missing vertex attribute: ${attr}`);
                }
            });

            const indexAcc = prim.getIndices();
            let indices: Uint32Array | Uint16Array = indexAcc?.getArray();
            let indexType: "uint16" | "uint32" | "Unknown" =
                indices instanceof Uint16Array ? 'uint16' :
                    'uint32';
            let correctedIndices;
            if (indexType === "uint16" && indices.byteLength % 4 !== 0) {
                correctedIndices = new Uint32Array(indices.length);
                correctedIndices.set(indices)
                indexType = "uint32"
            }

            geometryData.push({
                uniforms,
                vertex,
                indices: indices.byteLength % 4 !== 0 ? correctedIndices : indices,
                indexType,
                lodRanges: lodRanges,
                indexCount: indices?.length ?? 0,
                material: prim.getMaterial()
            });
        }

        return geometryData;
    }

    public dispose(): void {
        this.cache.clear();
    }
}