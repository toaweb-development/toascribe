# WordPress nb_NO default content, as WordPress stores it

Upstream text for `test/default-content.test.ts`, kept as plain `.txt` so no formatter touches a byte. Built from
WordPress 7.1.3 (`wp_install_defaults()`, `WP_Privacy_Policy_Content::get_default_content()`) and WordPress' nb_NO
translation (translate.wordpress.org, wp/dev and wp/dev/admin, nb, PO-Revision-Date 2026-10-08), read 2026-10-23.

- `wp-first-post-nb.txt`: the first post's `post_content`.
- `wp-first-comment-nb.txt`: the first comment's `comment_content`.
- `wp-sample-page-nb.txt`: the sample page's `post_content`; `ADMINURL` stands for `admin_url()`.
- `wp-privacy-policy-nb.txt`: the privacy page's `post_content`; `{SITEURL}` stands for the site URL. It has the two
  broken entities of the translation (`&lauot;`, `&raquot;`), which toascribe stores as « and ».
