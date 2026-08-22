# Frontal Team member presets

These files use the member-preset library format exported and imported by the Fleet Web
configuration surface.

`frontal-team-member-presets.json` is the recommended import. It contains 16 unique logical roles in
two groups: `frontal-coding` and `frontal-research`. Each `*-preset.json` file is the equivalent
single-member export for inspection, sharing, or a deliberately minimal library.

The current importer replaces the library's complete `groups` and `members` arrays; it does not merge
members by id. Import the aggregate file to retain all Frontal roles. Importing one single-member file
intentionally leaves only that member plus its group in the member library. Field presets are
preserved by the importer.

Each exported member file has this shape:

```json
{
  "version": 1,
  "groups": [
    { "id": "frontal-coding", "name": ["Frontal 研发", "Frontal Coding"] },
    { "id": "default", "name": ["默认", "Default"] }
  ],
  "members": [
    {
      "id": "core-engineer",
      "displayName": "Core Engineer",
      "role": ["核心工程师", "core engineer"],
      "responsibilities": ["中文职责", "English responsibility"],
      "prompt": "Independent member prompt",
      "provider": "",
      "model": "",
      "groupId": "frontal-coding"
    }
  ]
}
```

Roles repeated by the small, medium, and large Team configurations are represented once because the
member library treats `id` as the stable selection key. The canonical preset keeps the most detailed
prompt among those Team variants. Team-specific prompt variants remain unchanged in `../teams/`.
