import { toFountain } from './fountain';

describe('toFountain', () => {
  it('formats scenes and dialogue as Fountain text', () => {
    const result = toFountain({
      title: 'Test Film',
      genre: 'Drama',
      scenes: [
        {
          heading: 'INT. ROOM - NIGHT',
          action: 'A clock stops.',
          dialogue: [{ character: 'Lin', parenthetical: 'quietly', text: 'We are late.' }],
        },
      ],
    });
    expect(result).toContain('Title: Test Film');
    expect(result).toContain('INT. ROOM - NIGHT');
    expect(result).toContain('(quietly)');
  });
});
