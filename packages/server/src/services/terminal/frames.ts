/**
 * Temporary forwarding module (S2).
 *
 * The terminal frame codec now lives in `transport/terminal`.
 */
export { OPCODES, encodeFrame, decodeFrame, type Opcode } from '@/transport/terminal/frames';
