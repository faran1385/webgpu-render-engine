import {Accessor, Document, Root, Skin, TypedArray, WebIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {mat3, mat4} from 'gl-matrix';
import {AttributeData, GeometryData, LODRange, MeshData,} from "./loaderTypes.ts";

const io = new WebIO().registerExtensions(ALL_EXTENSIONS);

/** A GLTF/GLB loader class with optional caching and progress reporting. */
export class GLTFLoader {
    /**
     * Loads a model from URL and returns document, meshes, buffers, and animations.
     */
    public async load(url: string,): Promise<{
        document: Document;
        meshes: MeshData[];
        skinIdList: number[];
        buffers: any[];
        root: Root,
        skeletonsMatList: Map<number, Float32Array>;
    }> {
        let document = await io.read(url);

        const root = document.getRoot();

        const skeletonsTypedArray = new Map<number, Float32Array>();
        const skinIdList: number[] = [];
        root.listSkins().forEach(skin => {
            const calculatedBones = this.calculateBones(skin)
            if (calculatedBones) {
                const id = Math.random();
                skinIdList.push(id);
                skeletonsTypedArray.set(id, new Float32Array(calculatedBones));
            }
        })

        const buffers = root.listBuffers();
        const meshes = await this.extractMeshes(root, skinIdList);
        const result = {
            document,
            meshes,
            skinIdList,
            buffers,
            root,
            skeletonsMatList: skeletonsTypedArray
        };

        return result;
    }


    private calculateBones(skin: Skin) {
        const boneList = skin.listJoints();
        const invBindMatrices = skin.getInverseBindMatrices()?.getArray();
        if (!invBindMatrices) return undefined;

        const bonesArray: number[] = [];

        for (let i = 0; i < boneList.length; i++) {
            const jointNode = boneList[i];
            const jointWorld = jointNode.getWorldMatrix();
            const invBind = invBindMatrices.slice(i * 16, i * 16 + 16);

            const jointMat = mat4.create();
            mat4.multiply(jointMat, jointWorld, invBind as any);

            bonesArray.push(...jointMat);
        }
        return bonesArray
    }

    private async extractMeshes(root: Root, skinIdList: number[]): Promise<MeshData[]> {
        const nodes = root.listNodes();
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
                const skin = node.getSkin();

                meshes.push({
                    nodeName: node.getName() || 'unnamed',
                    localMatrix: localMat,
                    normalMatrix: normalMatData,
                    geometry,
                    meshId: Math.random(),
                    skinId: skin ? skinIdList[root.listSkins().indexOf(skin)] : null
                });
            }

            count++;
        }
        return meshes;
    }


    /** Extracts and separates vertex attributes, uniforms, and pipeline layouts. */
    private async extractGeometry(mesh: any): Promise<GeometryData[]> {

        const primitives = mesh.listPrimitives();

        const geometryData: GeometryData[] = [];
        for (const prim of primitives) {

            let lodRanges: LODRange[] | undefined = undefined;
            if (prim.getExtras().lodRanges) {
                lodRanges = prim.getExtras().lodRanges;
            }
            const uniforms: Record<string, AttributeData> = {};
            const semantics = prim.listSemantics();

            prim.listAttributes().forEach((accessor: Accessor, i: number) => {
                let array = accessor.getArray() as TypedArray;
                const type = accessor.getType() as string;
                const itemSize =
                    type === 'SCALAR' ? 1 :
                        type === 'VEC2' ? 2 :
                            type === 'VEC3' ? 3 :
                                type === 'VEC4' ? 4 : array.length;
                const name = semantics[i];
                if (name === "JOINTS_0" && array instanceof Uint16Array) {
                    array = new Uint32Array(array)
                }
                uniforms[name] = {array, itemSize};
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
                dataList: uniforms,
                indices: indices.byteLength % 4 !== 0 ? correctedIndices : indices,
                indexType,
                lodRanges: lodRanges,
                indexCount: indices?.length ?? 0,
                material: prim.getMaterial(),
                id: Math.random()
            });
        }

        return geometryData;
    }

}