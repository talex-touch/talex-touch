import { codeFileParser } from './parsers/code-chunk-parser'
import { pdfFileParser } from './parsers/pdf-parser'
import { textFileParser } from './parsers/text-parser'
import { fileParserRegistry } from './registry'

fileParserRegistry.register(codeFileParser)
fileParserRegistry.register(pdfFileParser)
fileParserRegistry.register(textFileParser)

export * from './registry'
export * from './types'
export { codeFileParser, pdfFileParser, textFileParser }
