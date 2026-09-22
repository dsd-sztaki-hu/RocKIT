import { parseGlobalEntityMappingJson } from './global-entity-mapping-json'

describe('parseGlobalEntityMappingJson', () => {
    it('loads a valid mapping', () => {
        expect(parseGlobalEntityMappingJson('{"author":{"record":{}}}')).toEqual({
            author: { record: {} },
        })
    })

    it('recovers from an empty mapping file', () => {
        expect(parseGlobalEntityMappingJson('   \n')).toEqual({})
    })

    it('recovers from an interrupted mapping write', () => {
        expect(parseGlobalEntityMappingJson('{"author":')).toEqual({})
    })
})
