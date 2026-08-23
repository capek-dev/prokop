declare module '@npmcli/arborist' {
  interface ArboristOptions {
    path?: string;
    registry?: string;
    cache?: string;
    preferOnline?: boolean;
  }

  interface ArboristNode {
    path: string;
    package?: {
      name?: string;
      version?: string;
      dist?: {
        integrity?: string;
      };
    };
    children: Map<string, ArboristNode>;
    inventory?: Map<string, ArboristNode>;
  }

  class Arborist {
    constructor(options: ArboristOptions);
    reify(): Promise<ArboristNode>;
  }

  export { ArboristNode };
  export default Arborist;
}
