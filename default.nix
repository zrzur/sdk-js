{
  pkgs ? import <nixpkgs> { },
}: pkgs.mkShell {
  name = "zrzurEnv";

  buildInputs = with pkgs; [
    # Tools
    git
    gh
    deno

    # Node
    nodejs
    pnpm_10
  ];
}
