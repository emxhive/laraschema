export type StubType = 'migration' | 'model' | 'enum' | 'ts';

export interface CustomizeOptions {
   schema: string;
   types: string[];
   names: string[];
   update?: boolean;
}
