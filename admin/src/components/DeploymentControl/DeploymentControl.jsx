import { Check, ChevronDown, CloudOff } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import "./DeploymentControl.scss";

function DeploymentControl({ active, onChange }) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRef = useRef(null);
  const triggerId = useId();
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    optionRef.current?.focus();
    function closeOnPointer(event) {
      if (!changing && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!changing) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [changing, open]);

  async function toggleSkipping() {
    if (changing) return;
    setChanging(true);
    setError("");
    try {
      await onChange(!active);
      setOpen(false);
      triggerRef.current?.focus();
    } catch (changeError) {
      setError(changeError.message || "Could not change the deployment mode.");
      window.setTimeout(() => optionRef.current?.focus(), 0);
    } finally {
      setChanging(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className={`deployment-control${active ? " is-active" : ""}`}
      onBlur={(event) => {
        if (
          !changing &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setOpen(false);
        }
      }}
    >
      <button
        id={triggerId}
        ref={triggerRef}
        type="button"
        className="deployment-control__trigger"
        aria-label={active ? "Save options, deployments skipped" : "Save options"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-disabled={changing}
        title={active ? "Deployments are skipped" : "Save options"}
        onClick={() => {
          if (!changing) setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (!changing && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <CloudOff
          className="deployment-control__status"
          size={14}
          aria-hidden="true"
        />
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="deployment-control__menu">
          <div id={menuId} role="menu" aria-labelledby={triggerId}>
            <button
              ref={optionRef}
              type="button"
              role="menuitemcheckbox"
              aria-checked={active}
              aria-busy={changing}
              aria-disabled={changing}
              onKeyDown={(event) => {
                if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  optionRef.current?.focus();
                }
              }}
              onClick={toggleSkipping}
            >
              <span className="deployment-control__check" aria-hidden="true">
                {active && <Check size={14} />}
              </span>
              <span>
                <strong>
                  {changing
                    ? active
                      ? "Resuming deployment"
                      : "Pausing deployments"
                    : "Skip deployments"}
                </strong>
                <small>
                  {active ? (
                    "Turn this off to deploy the latest saved GitHub state."
                  ) : (
                    <>
                      Add <code>[ci skip]</code> to every GitHub commit.
                    </>
                  )}
                </small>
              </span>
            </button>
          </div>
          {error && (
            <p className="deployment-control__error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export { DeploymentControl };
