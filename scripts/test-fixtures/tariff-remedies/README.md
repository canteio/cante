# Official tariff-rule fixture

Public USITC data captured October 18, 2026, revision 2026HTSRev21.
No competitor or customer data. Fixture use does not imply that these rules
remain current in a later test run. Production always fetches fresh data.

Sources:
- https://hts.usitc.gov/reststop/getChapterNotes?doc=99
- https://hts.usitc.gov/reststop/exportList?from=9901&to=9999&format=JSON&styles=false
- https://hts.usitc.gov/reststop/file?filename=China%20Tariffs&release=currentRelease

The gzip contains the decoded legal-note HTML, heading JSON and extracted
China-reference PDF text. Compressed SHA-256: 0c24d864d074a296ea9c769e44cc8d3a56a527d618fb2c7a7679f75c3204b005.
